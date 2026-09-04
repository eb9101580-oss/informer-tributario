import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { collectOfficialPage } from './collector.js';
import { analyzeDocument } from './ollama.js';
import { calculateScore, relevanceLabel } from './scoring.js';
import { discoverSourceCandidates, hasStrongTaxSignal, isExcludedTaxTopic, isTaxRelated, sourceDateCoverage } from './sourceAdapters.js';
import { readDatabase, updateDatabase } from './store.js';
import { sectionIdsForSource } from '../data/sections.js';
import { isPublishedWithinDays, publicationDateKey } from './feedWindow.js';
import { hasCandidateText, unpackCandidateText } from './candidateText.js';
import { loadMonitoredSources } from './customSources.js';
import { collectPublicSourceDocument } from './sourceSafety.js';
import { assessAlertAnalysisQuality, assessTaxIntelligenceCandidate, TAX_POLICY_VERSION } from './taxIntelligencePolicy.js';
import { resolveScoutingCandidate, resolveScoutingToPrimary } from './scoutingResolver.js';

const runtime = { running: false, phase: 'idle', currentSource: null, currentDocument: null, startedAt: null, error: null };
let timer;

export function monitorData(database) {
  return database.monitor || { candidates: [], runs: [], lastRunAt: null, nextRunAt: null };
}

export function candidateId(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

function canonicalLegalObject(candidate) {
  const text = String(`${candidate.title || ''} ${candidate.documentKind || ''} ${candidate.url || ''}`)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cnj = text.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/)?.[0];
  if (cnj) return `processo-cnj:${cnj}`;
  const courtCase = text.match(/\b(re|resp|aresp|rcl|adi|adc|adpf|aco)\s*(?:n(?:\.|º|°)?\s*)?([\d.]{4,})(?:\s*\/\s*([a-z]{2}))?/i);
  if (courtCase) return `processo:${courtCase[1]}:${courtCase[2].replace(/\D/g, '')}:${courtCase[3] || ''}`;
  const theme = text.match(/\btema\s*(?:repetitivo\s*)?(\d{1,5})\b/);
  if (theme) return `tema:${theme[1]}`;
  const act = text.match(/\b(instrucao normativa(?:\s+rfb)?|portaria(?:\s+(?:rfb|mf))?|resolucao|solucao de (?:consulta|divergencia)|parecer normativo|ato declaratorio(?:\s+(?:interpretativo|executivo))?|convenio icms|ajuste sinief|ato cotepe)\s*(?:n(?:\.|º|°)?\s*)?([\d.]+)(?:\s*\/\s*(\d{4}))?/);
  if (act) return `ato:${act[1]}:${act[2]}:${act[3] || ''}`;
  return null;
}

function canonicalLegalEvent(candidate) {
  const text = String(`${candidate.title || ''} ${candidate.documentKind || ''}`)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/modulacao/.test(text)) return 'modulacao';
  if (/embargos?/.test(text)) return 'embargos';
  if (/afeta(?:cao|do|da|r)?|repercussao geral reconhecida/.test(text)) return 'afetacao';
  if (/publicacao do acordao|acordao publicado|inteiro teor/.test(text)) return 'publicacao-inteiro-teor';
  if (/julgamento de merito|merito julgado|tese fixada|fixa tese/.test(text)) return 'julgamento-merito';
  if (/nova versao|versao\s*[\d.]+|novo leiaute|novo layout/.test(text)) return 'nova-versao';
  if (/altera|alteracao|modifica|revoga/.test(text)) return 'alteracao';
  if (/publica|institui|regulamenta|aprova/.test(text)) return 'publicacao';
  return 'evento';
}

export function candidateFingerprint(candidate) {
  const legalObject = canonicalLegalObject(candidate);
  if (legalObject) {
    const eventDate = publicationDateKey(candidate.publishedAt) || candidate.backfillDate || '';
    return createHash('sha256').update(`${legalObject}:${canonicalLegalEvent(candidate)}:${eventDate}`).digest('hex').slice(0, 24);
  }
  if (candidate.fingerprintKey) return createHash('sha256').update(`${candidate.sourceId}:${candidate.fingerprintKey}`).digest('hex').slice(0, 24);
  const substantiveTitle = String(candidate.title || '').split('—').slice(1).join('—').trim() || candidate.title || candidate.url;
  return createHash('sha256').update(`${candidate.sourceId}:${substantiveTitle}`).digest('hex').slice(0, 24);
}

export function normalizeMonitorTargetDate(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null;
  const targetDate = String(value).trim();
  const match = targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  const isValidCalendarDate = parsed
    && parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3]);
  if (!isValidCalendarDate) {
    const error = new Error('Informe uma data válida no formato AAAA-MM-DD.');
    error.statusCode = 400;
    throw error;
  }
  if (targetDate > publicationDateKey(now)) {
    const error = new Error('A data da busca não pode estar no futuro.');
    error.statusCode = 400;
    throw error;
  }
  return targetDate;
}

export function shouldRetainQueuedCandidate(item, targetDate = null, now = new Date()) {
  // Uma busca complementar por data não pode apagar candidatos coletados no
  // ciclo principal. A limpeza da janela ocorre apenas na varredura geral.
  if (targetDate) return true;
  const candidateDate = publicationDateKey(item.publishedAt) || item.backfillDate;
  return isPublishedWithinDays(candidateDate, config.monitorLookbackDays, now);
}

function makeAlert(analysis, document, candidate, existingAlert = null) {
  const score = calculateScore(analysis.criteria);
  const now = new Date().toISOString();
  const analyzedPublishedAt = Number.isNaN(Date.parse(analysis.publishedAt)) ? null : analysis.publishedAt;
  const editorialPolicy = candidate.fastTriage?.policy || assessTaxIntelligenceCandidate({ ...candidate, content: document.text });
  return {
    ...(existingAlert || {}), ...analysis, id: existingAlert?.id || randomUUID(), score, relevance: relevanceLabel(score),
    priority: editorialPolicy.priority || analysis.priority,
    officialUrl: candidate.url, primarySourceUrl: candidate.sourceType === 'official' ? candidate.url : null, sourceUrl: candidate.url,
    policyVersion: TAX_POLICY_VERSION,
    legalBasis: (Array.isArray(analysis.legalBasis) && analysis.legalBasis.length)
      ? analysis.legalBasis
      : [candidate.legalCase?.formatted, candidate.documentKind].filter(Boolean),
    publishedAt: candidate.publishedAt || document.publishedAt || analyzedPublishedAt,
    isDemo: false, createdAt: existingAlert?.createdAt || now, updatedAt: now,
    provenance: {
      ...(existingAlert?.provenance || {}),
      analysisMode: 'ollama', detailedAnalysisPending: false,
      collector: hasCandidateText(candidate) ? (candidate.inlineParser || 'Consulta oficial estruturada') : 'Scrapling', analyzer: `Triagem rápida/regras + ${config.analysisProvider}/${config.ollamaModel}`, collectorUrl: candidate.collectionUrl || candidate.url, sourceCharacters: document.characters,
      sourceId: candidate.sourceId, sourceName: candidate.sourceName, discoveredBy: candidate.discoveryMethod,
      sourceType: candidate.sourceType || 'official',
      documentKind: candidate.documentKind, discoveredAt: candidate.discoveredAt,
      sourceDocumentType: candidate.sourceDocumentType,
      policyVersion: TAX_POLICY_VERSION,
      analysisVersion: analysis.analysisVersion,
      fastTriage: candidate.fastTriage || fastTriageCandidate(candidate),
    },
    sections: candidate.sections || sectionIdsForSource(candidate.sourceId),
  };
}

function candidateSections(candidate) {
  return candidate.sections?.length ? candidate.sections : sectionIdsForSource(candidate.sourceId);
}

function operationalUpdateRank(candidate) {
  const text = `${candidate.title || ''} ${candidate.documentKind || ''}`;
  if (/inteiro teor|ac[oó]rd[aã]o|decis[aã]o|senten[cç]a/i.test(candidate.documentKind || '')) return 1;
  return /instru[cç][aã]o normativa|portaria|solu[cç][aã]o de (consulta|diverg[eê]ncia)|nota t[eé]cnica|ajuste sinief|manual|leiaute|layout|resolu[cç][aã]o|decreto|\blei\b|altera[cç][aã]o/i.test(text) ? 0 : 1;
}

function sourceTypeRank(candidate) {
  return candidate.sourceType === 'official' ? 0 : 1;
}

function sourcePolicyRank(candidate) {
  const sourceId = String(candidate.sourceId || '').toLowerCase();
  if (['diario-oficial', 'reforma-cgibs', 'pgfn-pareceres', 'pgfn-noticias'].includes(sourceId) || sourceId.startsWith('receita-')) return 0;
  if (['carf', 'carf-noticias'].includes(sourceId)) return 1;
  if (['stf', 'stj', 'stj-noticias', 'stf-informativos', 'stj-informativos'].includes(sourceId)) return 2;
  if (sourceId === 'confaz-ajustes' || sourceId === 'nfe-notas-tecnicas' || sourceId.startsWith('sped-')) return 3;
  if (/^trf[1-6]$/.test(sourceId)) return 4;
  if (['camara', 'senado'].includes(sourceId)) return 5;
  return candidate.sourceType === 'official' ? 6 : 9;
}

function freshnessRank(candidate, now = Date.now()) {
  const discoveredAt = Date.parse(candidate.discoveredAt || '');
  return Number.isFinite(discoveredAt) && now - discoveredAt <= 2 * 60 * 60 * 1000 ? 0 : 1;
}

function sectionRank(candidate) {
  const sections = candidateSections(candidate);
  if (sections.includes('reforma')) return 0;
  if (sections.includes('obrigacoes')) return 1;
  return 2;
}

const MERIT_PATTERN = /ac[oó]rd[aã]o|senten[cç]a|m[eé]rito|tese|repercuss[aã]o geral|repetitivo|incid[eê]ncia|n[aã]o incid[eê]ncia|inconstitucional|constitucional|provimento|improvimento|restitui[cç][aã]o|compensa[cç][aã]o|imunidade|isen[cç][aã]o|cr[eé]dito/i;
const PROCEDURAL_PATTERN = /intima[cç][aã]o|publica[cç][aã]o|disponibiliza[cç][aã]o|juntada|peti[cç][aã]o|vista|recebimento|conclus[aã]o|despacho|ci[eê]ncia|prazo|distribui[cç][aã]o/i;
const STRUCTURED_ADAPTERS = new Set(['stj-open-data', 'stf-jurisprudence', 'trf-djen', 'receita-normas', 'carf-solr', 'camara-api', 'senado-api']);
const OPERATIONAL_SOURCES = new Set(['receita-cosit', 'receita-in', 'receita-notas', 'diario-oficial', 'confaz-ajustes', 'nfe-notas-tecnicas', 'sped-notas-tecnicas']);

// Primeira etapa do funil: pontuação barata, baseada somente em metadados e
// sinais explícitos. Ela examina toda a fila em milissegundos; o Ollama fica
// reservado para a análise jurídica detalhada dos candidatos mais promissores.
export function fastTriageCandidate(candidate) {
  const cleanTitle = String(candidate.title || '').replace(/[—-]\s*direito tribut[aá]rio\s*:\s*/i, ' ');
  const text = `${cleanTitle} ${candidate.documentKind || ''} ${unpackCandidateText(candidate).slice(0, 14000)}`;
  const signals = [];
  let score = 0;
  const policy = assessTaxIntelligenceCandidate({ ...candidate, content: unpackCandidateText(candidate).slice(0, 60000) });
  if (publicationDateKey(candidate.publishedAt)) { score += 20; signals.push('data-confirmada'); }
  if ((candidate.sourceType || 'official') === 'official') { score += 12; signals.push('fonte-oficial'); }
  if (STRUCTURED_ADAPTERS.has(candidate.discoveryMethod)) { score += 14; signals.push('coleta-estruturada'); }
  if (hasStrongTaxSignal(text)) { score += 20; signals.push('assunto-tributario-forte'); }
  else if (isTaxRelated(text)) { score += 9; signals.push('assunto-tributario'); }
  if (operationalUpdateRank(candidate) === 0 || OPERATIONAL_SOURCES.has(candidate.sourceId)) { score += 18; signals.push('efeito-operacional'); }
  const hasMerit = MERIT_PATTERN.test(text);
  if (hasMerit) { score += 16; signals.push('conteudo-de-merito'); }
  if (PROCEDURAL_PATTERN.test(text) && !hasMerit) { score -= 18; signals.push('possivel-ato-processual'); }
  if (candidate.sections?.includes('reforma') || candidate.sections?.includes('obrigacoes')) score += 6;
  score += Math.round(policy.score * 0.45);
  if (policy.priorityOneTopics.length) signals.push(...policy.priorityOneTopics.map((topic) => `politica-p1:${topic}`));
  if (policy.priorityTwoTopics.length) signals.push(...policy.priorityTwoTopics.map((topic) => `politica-p2:${topic}`));
  if (!policy.eligible) score -= 28;
  if (policy.exclusionReason) score = 0;
  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    band: boundedScore >= 70 ? 'alta' : boundedScore >= 45 ? 'media' : 'baixa',
    signals,
    engine: `regras-tributarias-v2:${policy.version}`,
    policy,
  };
}

export function classifyCandidateForQueue(candidate) {
  const fastTriage = candidate.promotedFromScouting ? fastTriageCandidate(candidate) : (candidate.fastTriage || fastTriageCandidate(candidate));
  const scouting = candidate.discoveryRole === 'scouting' || candidate.sourceType === 'journalistic';
  if (scouting) return { ...candidate, fastTriage, status: 'scouting', discardReason: null };
  const policy = fastTriage.policy;
  if ((candidate.sourceType || 'official') !== 'official' || !policy?.eligible || !policy?.primarySource || policy?.exclusionReason) {
    return {
      ...candidate,
      fastTriage,
      status: 'discarded',
      discardReason: policy?.eligibilityReason || policy?.exclusionReason || 'Fonte oficial primaria nao confirmada.',
    };
  }
  return { ...candidate, fastTriage, status: 'pending', discardReason: null };
}

const FAST_TAXES = [
  ['ICMS', /\bicms\b/i], ['ISS', /\biss(?:qn)?\b/i], ['IPI', /\bipi\b/i], ['PIS', /\bpis\b/i],
  ['Cofins', /cofins?/i], ['IRPJ', /irpj/i], ['IRPF', /irpf/i], ['IRRF', /irrf/i], ['CSLL', /csll/i],
  ['CBS', /\bcbs\b/i], ['IBS', /\bibs\b/i], ['IPTU', /\biptu\b/i], ['IPVA', /\bipva\b/i],
  ['ITBI', /\bitbi\b/i], ['CPRB', /cprb/i], ['FUNRURAL', /funrural/i],
  ['PASEP', /pasep/i], ['CIDE', /\bcide\b/i], ['AFRMM', /afrmm/i], ['SPED', /sped/i],
];

function shortenFastText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, '').trim();
  return `${clipped}…`;
}

function fastTaxLabels(text) {
  return FAST_TAXES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 6);
}

function fastEvidenceSentence(candidate) {
  const text = unpackCandidateText(candidate).slice(0, 16000)
    .replace(/\b(EMENTA|RELATÓRIO|FUNDAMENTAÇÃO|DISPOSITIVO|SENTENÇA|ACÓRDÃO)\b/gi, '. $1. ')
    .replace(/\b(art|arts|inc|incs|n|nº|dr|dra|sr|sra)\./gi, '$1\uE000')
    .replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\uE000/g, '.').replace(/^(?:EMENTA|RELATÓRIO|FUNDAMENTAÇÃO|DISPOSITIVO|SENTENÇA|ACÓRDÃO)\.?\s*/i, '').trim())
    .filter((sentence) => sentence.length >= 45 && !/^(?:PODER JUDICIÁRIO|ADVOGAD[OA]|IMPETRANTE|IMPETRADO|AUTOR|RÉU|FISCAL DA LEI|ENDEREÇO)/i.test(sentence));
  const substantive = sentences.find((sentence) => /julgo|concedo|denego|defiro|indefiro|dou provimento|nego provimento|altera|institui|revoga|aprova|prorroga/i.test(sentence))
    || sentences.find((sentence) => hasStrongTaxSignal(sentence) || MERIT_PATTERN.test(sentence));
  return shortenFastText(substantive || sentences[0] || text, 520);
}

function fastSentences(candidate) {
  return unpackCandidateText(candidate).slice(0, 60000)
    .replace(/\b(EMENTA|RELATÓRIO|FUNDAMENTAÇÃO|DISPOSITIVO|SENTENÇA|ACÓRDÃO)\b/gi, '. $1. ')
    .replace(/\b(art|arts|inc|incs|n|nº|dr|dra|sr|sra)\./gi, '$1\uE000')
    .replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\uE000/g, '.').replace(/^(?:EMENTA|RELATÓRIO|FUNDAMENTAÇÃO|DISPOSITIVO|SENTENÇA|ACÓRDÃO)\.?\s*/i, '').trim())
    .filter((sentence) => sentence.length >= 25);
}

function fastDecisionOutcome(sentences) {
  const patterns = [
    /ante (?:o|todo) exposto/i,
    /julgo (?:parcialmente )?(?:procedente|improcedente)/i,
    /(?:concedo|denego) (?:a )?segurança/i,
    /(?:dou|nego|dar|deram|negaram) provimento/i,
    /julgar(?:am)? (?:parcialmente )?(?:procedente|improcedente)/i,
    /(?:decidiu|acordaram|resolveu)\b/i,
    /(?:defiro|indefiro|acolho|rejeito|declaro|reconheço|determino|homologo|extingo)\b/i,
  ];
  for (const pattern of patterns) {
    const matches = sentences.filter((sentence) => pattern.test(sentence));
    if (matches.length) return shortenFastText(matches.at(-1), 620);
  }
  return '';
}

function fastDecisionTopic(candidate, sentences) {
  const topic = sentences.find((sentence) => hasStrongTaxSignal(sentence)
    && /objetivando|pretende|controvérsia|discute|requer(?:eu)? (?:o |a )?(?:reconhecimento|declaração|exclusão|restituição|compensação)/i.test(sentence));
  if (topic) {
    const marker = topic.search(/objetivando|pretende|controvérsia|discute|requer(?:eu)? (?:o |a )?(?:reconhecimento|declaração|exclusão|restituição|compensação)/i);
    const focused = marker >= 0 ? topic.slice(marker) : topic;
    const contextualized = focused
      .replace(/^objetivando\s+seja\s+declarado o direito de/i, 'O pedido buscava o reconhecimento do direito de')
      .replace(/^objetivando\s+seja\s+/i, 'O pedido buscava que fosse ')
      .replace(/^objetivando\s+/i, 'O pedido buscava ');
    return shortenFastText(contextualized, 620);
  }
  const titleTopic = String(candidate.title || '').split(/direito tributário\s*:\s*/i)[1];
  return shortenFastText(titleTopic || fastEvidenceSentence(candidate), 520);
}

function fastDecisionReason(sentences, outcome) {
  const candidates = sentences.filter((sentence) => sentence !== outcome && hasStrongTaxSignal(sentence)
    && /não pode ser acolhid|não comporta acolhimento|inexiste fundamento|constitucionalidade|inconstitucionalidade|legalidade|ilegalidade|não integra|integra.{0,80}base de cálculo|firmou (?:o )?entendimento|conclui-se/i.test(sentence));
  return shortenFastText(candidates.at(-1) || '', 620);
}

function sourceWithArticle(sourceName) {
  if (/^(?:Tribunal|Supremo|Superior|STF|STJ|TRF|CARF|Conselho)/i.test(sourceName)) return `O ${sourceName}`;
  if (/^(?:Receita|Câmara|Secretaria|Procuradoria)/i.test(sourceName)) return `A ${sourceName}`;
  return sourceName;
}

function outcomeClassification(outcome) {
  if (/improcedente|deneg|indefir|neg(?:o|ar|aram) provimento|desprovido|rejeit/i.test(outcome)) return 'negative';
  if (/procedente|conced|defer|(?:dou|dar|deram) provimento|provido|acolh/i.test(outcome)) return 'positive';
  return 'neutral';
}

export function fastPublicationDetails(candidate, { sourceName, kind, taxes, date } = {}) {
  const resolvedSource = sourceName || candidate.sourceName || candidate.sourceAcronym || 'Fonte oficial';
  const resolvedKind = kind || candidate.documentKind || 'Publicação oficial';
  const resolvedTaxes = taxes?.length ? taxes : fastTaxLabels(`${candidate.title || ''} ${unpackCandidateText(candidate).slice(0, 16000)}`);
  const resolvedDate = date || publicationDateKey(candidate.publishedAt);
  const sentences = fastSentences(candidate);
  const evidence = fastEvidenceSentence(candidate);
  const judicial = /sentença|acórdão|decisão|julgamento|despacho/i.test(resolvedKind);
  const outcome = judicial ? fastDecisionOutcome(sentences) : '';
  const topic = judicial ? fastDecisionTopic(candidate, sentences) : evidence;
  const reason = judicial ? fastDecisionReason(sentences, outcome) : '';
  const processNumber = String(candidate.title || '').match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/)?.[0];
  const conciseKind = resolvedKind.replace(/\s+publicad[oa].*$/i, '').trim().toLowerCase();

  if (judicial && outcome) {
    const classification = outcomeClassification(outcome);
    const scope = /sentença/i.test(resolvedKind)
      ? 'É uma decisão de primeira instância e pode ser objeto de recurso.'
      : 'O alcance do julgamento deve ser conferido no inteiro teor e conforme a fase processual.';
    const impact = classification === 'negative'
      ? 'A tese do contribuinte foi rejeitada neste processo.'
      : classification === 'positive'
        ? 'A tese do contribuinte foi acolhida neste processo.'
        : 'O julgamento definiu o tratamento do tema neste processo.';
    const taxScope = resolvedTaxes.length ? ` O caso envolve ${resolvedTaxes.join(', ')}.` : '';
    const titleKind = resolvedKind.replace(/\s+judicial.*$/i, '').replace(/\s+publicad[oa].*$/i, '').trim();
    const resultLabel = classification === 'negative' ? 'tese rejeitada' : classification === 'positive' ? 'tese acolhida' : 'resultado publicado';
    return {
      title: [titleKind, processNumber, resolvedTaxes.join(' e ') || null, resultLabel].filter(Boolean).join(' · '),
      summary: `${sourceWithArticle(resolvedSource)}${processNumber ? `, no processo ${processNumber},` : ''} proferiu ${conciseKind}${resolvedDate ? ` em ${resolvedDate}` : ''}. ${topic}`,
      whatChanged: `${outcome}${reason ? ` Fundamento identificado: ${reason}` : ''}`,
      practicalImpact: `${impact}${taxScope} ${scope}`,
      officeAction: classification === 'negative'
        ? 'Conferir o inteiro teor, o prazo recursal e se há distinções relevantes antes de aplicar a conclusão a casos semelhantes.'
        : 'Conferir o inteiro teor, o alcance subjetivo, eventual recurso e os documentos necessários antes de aplicar a conclusão ao cliente.',
      affectedProfiles: resolvedTaxes.length ? [`Contribuintes com discussões sobre ${resolvedTaxes.join(', ')}`] : ['Partes e contribuintes com tese equivalente'],
    };
  }

  const change = sentences.find((sentence) => /altera|institui|revoga|aprova|prorroga|regulamenta|estabelece|dispõe sobre|decidiu|firmou/i.test(sentence));
  return {
    summary: `${sourceWithArticle(resolvedSource)} publicou ${conciseKind}${resolvedDate ? ` em ${resolvedDate}` : ''}. ${topic || evidence}`,
    whatChanged: shortenFastText(change || topic || evidence || candidate.title, 620),
    practicalImpact: resolvedTaxes.length
      ? `A publicação trata de ${resolvedTaxes.join(', ')}. É necessário verificar vigência, destinatários e providências descritas no texto oficial.`
      : 'A publicação deve ser conferida quanto à vigência, aos destinatários e às providências expressamente previstas no texto oficial.',
    officeAction: 'Comparar o texto publicado com o procedimento atual e registrar prazo, vigência e responsáveis por eventual adequação.',
  };
}

export function enrichFastAlert(alert, candidate) {
  if (!candidate || alert?.provenance?.analysisMode !== 'fast-triage') return alert;
  const details = fastPublicationDetails(candidate, {
    sourceName: alert.agency,
    kind: alert.kind,
    taxes: alert.taxes || [],
    date: publicationDateKey(alert.publishedAt),
  });
  return { ...alert, ...details };
}

export function canFastPublishCandidate(_candidate) {
  // A triagem determinística serve somente para ordenar a fila. A publicação
  // exige sempre a análise estruturada do Ollama e o gate editorial completo.
  return false;
}

export function makeFastAlert(candidate) {
  const triage = candidate.fastTriage || fastTriageCandidate(candidate);
  const sourceName = candidate.sourceName || candidate.sourceAcronym || 'Fonte oficial';
  const kind = candidate.documentKind || 'Publicação oficial';
  const evidence = fastEvidenceSentence(candidate);
  const taxes = fastTaxLabels(`${candidate.title || ''} ${evidence}`);
  const date = publicationDateKey(candidate.publishedAt);
  const score = Math.round((triage.score / 10) * 10) / 10;
  const now = new Date().toISOString();
  const title = shortenFastText(candidate.title || kind, 180);
  const details = fastPublicationDetails(candidate, { sourceName, kind, taxes, date });
  return {
    relevant: true,
    title: details.title || title,
    theme: taxes.length ? `Direito tributário · ${taxes.join(', ')}` : 'Direito tributário',
    agency: sourceName,
    taxes,
    status: 'Fato confirmado',
    kind,
    impactType: 'Informativo',
    publishedAt: candidate.publishedAt || now,
    summary: details.summary || evidence,
    whatChanged: details.whatChanged,
    practicalImpact: details.practicalImpact,
    officeAction: details.officeAction,
    affectedProfiles: details.affectedProfiles || ['Contribuintes e empresas do tema indicado'],
    criteria: { authority: 9, novelty: date ? 8 : 6, legalImpact: triage.signals.includes('conteudo-de-merito') ? 8 : 7, financialImpact: taxes.length ? 7 : 6, reach: 7, clientFit: 7, actionPotential: 6 },
    opportunity: null,
    id: randomUUID(),
    score,
    relevance: relevanceLabel(score),
    officialUrl: candidate.url,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    provenance: {
      collector: candidate.inlineParser || 'Consulta oficial estruturada',
      analyzer: 'Triagem rápida determinística (Ollama pendente)',
      analysisMode: 'fast-triage',
      detailedAnalysisPending: true,
      collectorUrl: candidate.collectionUrl || candidate.url,
      sourceCharacters: unpackCandidateText(candidate).length,
      sourceId: candidate.sourceId,
      sourceName,
      discoveredBy: candidate.discoveryMethod,
      sourceType: candidate.sourceType || 'official',
      documentKind: kind,
      sourceDocumentType: candidate.sourceDocumentType,
      discoveredAt: candidate.discoveredAt,
      fastTriage: triage,
    },
    sections: candidate.sections || sectionIdsForSource(candidate.sourceId),
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await mapper(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function getMonitorRuntime() {
  return { ...runtime, enabled: config.monitorEnabled, manualRunsSupported: !config.serverless, intervalMinutes: config.monitorIntervalMinutes, maxAnalysesPerRun: config.monitorMaxAnalyses };
}

export async function getMonitorSnapshot() {
  const database = await readDatabase();
  const monitor = monitorData(database);
  const sources = await loadMonitoredSources();
  return {

    runtime: getMonitorRuntime(), lastRunAt: monitor.lastRunAt, nextRunAt: monitor.nextRunAt,
    queued: monitor.candidates.filter((item) => item.status === 'pending').length,
    scouting: monitor.candidates.filter((item) => item.status === 'scouting').length,
    fastPublished: monitor.candidates.filter((item) => item.status === 'fast-published').length,
    analyzed: monitor.candidates.filter((item) => item.status === 'analyzed').length,
    discarded: monitor.candidates.filter((item) => item.status === 'discarded').length,
    errors: monitor.candidates.filter((item) => item.status === 'error').length,
    sources: sources.length,
  };
}

export async function runMonitor({ analyze = true, discover = true, trigger = 'manual', targetDate: rawTargetDate = null } = {}) {
  const targetDate = normalizeMonitorTargetDate(rawTargetDate);
  if (runtime.running) return { accepted: false, message: 'Já existe uma varredura em andamento.' };
  runtime.running = true;
  runtime.phase = 'discovery';
  runtime.startedAt = new Date().toISOString();
  runtime.error = null;
  const run = { id: randomUUID(), trigger, targetDate, startedAt: runtime.startedAt, finishedAt: null, discovered: 0, analyzed: 0, published: 0, discarded: 0, errors: 0, sources: [] };

  try {
    const sources = await loadMonitoredSources();
    await updateDatabase((database) => ({
      ...database,
      monitor: { ...monitorData(database), candidates: monitorData(database).candidates.map((item) => item.status === 'analyzing' ? { ...item, status: 'pending', error: 'Análise retomada após reinício do servidor.' } : item) },
    }));
    // Keep a fast-published card visible if the process restarted mid-analysis.
    await updateDatabase((database) => ({
      ...database,
      monitor: {
        ...monitorData(database),
        candidates: monitorData(database).candidates.map((item) => (item.status === 'analyzing' || (item.status === 'pending' && String(item.error || '').includes('retomada')))
          ? { ...item, status: item.alertId ? 'fast-published' : 'pending' }
          : item),
      },
    }));
    if (discover) {
    const results = await mapWithConcurrency(sources, 3, async (source) => {
      runtime.currentSource = source.acronym;
      return { source, items: await discoverSourceCandidates(source, config.monitorLookbackDays, { targetDate }) };
    });
    const found = [];
    results.forEach((result, index) => {
      const source = sources[index];
      if (result.status === 'fulfilled') {
        found.push(...result.value.items);
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'ok', found: result.value.items.length, dateCoverage: targetDate ? sourceDateCoverage(source) : null, ...(result.value.items.discoveryTelemetry ? { telemetry: result.value.items.discoveryTelemetry } : {}) });
      } else {
        run.errors += 1;
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'error', found: 0, message: result.reason?.message || 'Falha na fonte' });
      }
    });

    // Resolve pautas qualificadas de radar/scouting em processos judiciais oficiais
    const scoutingItems = found.filter((item) => (item.discoveryRole === 'scouting' || item.sourceType === 'journalistic') && hasStrongTaxSignal(item.title));
    for (const item of scoutingItems) {
      try {
        const resolved = await resolveScoutingCandidate(item, true);
        if (resolved) {
          found.push(resolved);
        }
      } catch {
        // segue sem quebrar o ciclo
      }
    }

    const promotedScoutingUrls = new Set();
    try {
      const currentDb = await readDatabase();
      const existingScouting = (monitorData(currentDb).candidates || [])
        .filter((item) => item.status === 'scouting' && (hasStrongTaxSignal(item.title) || isTaxRelated(item.title) || item.sourceType === 'journalistic'))
        .slice(0, 15);
      for (const item of existingScouting) {
        const resolved = await resolveScoutingCandidate(item, true);
        if (resolved) {
          found.push(resolved);
          promotedScoutingUrls.add(item.url);
        }
      }
    } catch {
      // segue sem quebrar o ciclo
    }

    await updateDatabase((database) => {
      const monitor = monitorData(database);
      const publishedFingerprints = new Set(monitor.candidates.filter((item) => ['analyzed', 'fast-published'].includes(item.status)).map(candidateFingerprint));
      const legacyFastAlertIds = new Set(monitor.candidates
        .filter((item) => item.status === 'fast-published' && item.alertId)
        .map((item) => item.alertId));
      const pendingFingerprints = new Set();
      const retained = monitor.candidates.map((item) => {
        if (promotedScoutingUrls.has(item.url)) {
          return { ...item, status: 'promoted', promotedAt: new Date().toISOString() };
        }
        if (item.promotedFromScouting && item.status === 'discarded') {
          const reclassified = classifyCandidateForQueue({ ...item, fastTriage: null, discardReason: null });
          if (reclassified.status === 'pending') {
            return reclassified;
          }
        }
        if (!['pending', 'error', 'fast-published'].includes(item.status)) return item;
        const classified = classifyCandidateForQueue(item);
        return classified.status === 'pending' && item.status === 'error'
          ? { ...classified, status: 'error', error: item.error }
          : classified;
      }).filter((item) => {
        if (['pending', 'error'].includes(item.status) && /^trf[1-6]$/.test(item.sourceId) && !hasCandidateText(item) && !item.publishedAt) return false;
        if (['pending', 'error'].includes(item.status) && !shouldRetainQueuedCandidate(item, targetDate)) return false;
        const fingerprint = candidateFingerprint(item);
        if (['pending', 'error'].includes(item.status) && (publishedFingerprints.has(fingerprint) || pendingFingerprints.has(fingerprint))) return false;
        if (['pending', 'error'].includes(item.status)) pendingFingerprints.add(fingerprint);
        return true;
      });
      const known = new Set([...retained.map((item) => item.id), ...database.alerts.map((item) => candidateId(item.officialUrl || item.id))]);
      const knownFingerprints = new Set(retained.map(candidateFingerprint));
      const additions = found.flatMap((item) => {
        if (targetDate ? publicationDateKey(item.publishedAt) !== targetDate : !isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays)) return [];
        const id = candidateId(item.url);
        const fingerprint = candidateFingerprint(item);
        if (known.has(id) || knownFingerprints.has(fingerprint)) return [];
        known.add(id);
        knownFingerprints.add(fingerprint);
        return [classifyCandidateForQueue({ ...item, id, attempts: 0, backfillDate: targetDate || null })];
      });
      run.discovered = additions.length;
      additions.sort((left, right) => sourcePolicyRank(left) - sourcePolicyRank(right));
      return {
        ...database,
        alerts: legacyFastAlertIds.size ? database.alerts.filter((item) => !legacyFastAlertIds.has(item.id)) : database.alerts,
        monitor: { ...monitor, candidates: [...additions, ...retained].slice(0, 20000) },
      };
    });

    if (config.monitorFastPublish && config.monitorFastPublishPerRun > 0) {
      await updateDatabase((database) => {
        const monitor = monitorData(database);
        const candidates = monitor.candidates
          .filter((item) => item.status === 'pending')
          .filter((item) => targetDate
            ? item.backfillDate === targetDate || publicationDateKey(item.publishedAt) === targetDate
            : isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays))
          .filter(canFastPublishCandidate)
          .sort((left, right) => (right.fastTriage?.score || 0) - (left.fastTriage?.score || 0)
            || String(right.publishedAt || right.discoveredAt).localeCompare(String(left.publishedAt || left.discoveredAt)))
          .slice(0, config.monitorFastPublishPerRun);
        if (!candidates.length) return database;
        const alerts = candidates.map((candidate) => makeFastAlert(candidate));
        const alertsByCandidate = new Map(candidates.map((candidate, index) => [candidate.id, alerts[index]]));
        const publishedAt = new Date().toISOString();
        run.published += alerts.length;
        return {
          ...database,
          alerts: [...alerts, ...database.alerts],
          meta: { ...database.meta, lastUpdatedAt: publishedAt },
          monitor: {
            ...monitor,
            candidates: monitor.candidates.map((item) => {
              const alert = alertsByCandidate.get(item.id);
              return alert ? { ...item, status: 'fast-published', alertId: alert.id, fastPublishedAt: publishedAt, error: null } : item;
            }),
          },
        };
      });
    }
    }

    if (analyze && config.monitorMaxAnalyses > 0) {
      runtime.phase = 'analysis';
      const database = await readDatabase();
      const prioritizedQueue = monitorData(database).candidates
        .filter((item) => item.status === 'pending' || item.status === 'fast-published' || (item.status === 'error' && item.attempts < 3))
        .filter((item) => !isExcludedTaxTopic(item.title, item.url, unpackCandidateText(item)))
        .filter((item) => targetDate
          ? item.backfillDate === targetDate || publicationDateKey(item.publishedAt) === targetDate
          : isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays))
        .map((item) => ({ ...item, fastTriage: item.fastTriage || fastTriageCandidate(item) }))
        .filter((item) => (item.sourceType || 'official') === 'official'
          && item.discoveryRole !== 'scouting'
          && item.fastTriage.policy?.eligible
          && item.fastTriage.policy?.primarySource
          && !item.fastTriage.policy?.exclusionReason)
        .sort((left, right) => {
          const leftTier = left.fastTriage.policy.priorityOneTopics.length ? 0 : 1;
          const rightTier = right.fastTriage.policy.priorityOneTopics.length ? 0 : 1;
          if (leftTier !== rightTier) return leftTier - rightTier;
          const leftConcrete = left.fastTriage.policy.concreteEvent && left.fastTriage.policy.businessEffect ? 0 : 1;
          const rightConcrete = right.fastTriage.policy.concreteEvent && right.fastTriage.policy.businessEffect ? 0 : 1;
          if (leftConcrete !== rightConcrete) return leftConcrete - rightConcrete;
          if (left.fastTriage.score !== right.fastTriage.score) return right.fastTriage.score - left.fastTriage.score;
          const leftSourcePriority = sourcePolicyRank(left);
          const rightSourcePriority = sourcePolicyRank(right);
          if (leftSourcePriority !== rightSourcePriority) return leftSourcePriority - rightSourcePriority;
          const leftFreshness = freshnessRank(left);
          const rightFreshness = freshnessRank(right);
          if (leftFreshness !== rightFreshness) return leftFreshness - rightFreshness;
          const leftDecision = /inteiro teor|acórdão|decisão|julgamento/i.test(left.documentKind) ? 0 : 1;
          const rightDecision = /inteiro teor|acórdão|decisão|julgamento/i.test(right.documentKind) ? 0 : 1;
          if (leftDecision !== rightDecision) return leftDecision - rightDecision;
          const leftOperational = operationalUpdateRank(left);
          const rightOperational = operationalUpdateRank(right);
          if (leftOperational !== rightOperational) return leftOperational - rightOperational;
          const leftSourceType = sourceTypeRank(left);
          const rightSourceType = sourceTypeRank(right);
          if (leftSourceType !== rightSourceType) return leftSourceType - rightSourceType;
          const leftSection = sectionRank(left);
          const rightSection = sectionRank(right);
          if (leftSection !== rightSection) return leftSection - rightSection;
          const leftStrong = hasStrongTaxSignal(left.title) ? 0 : 1;
          const rightStrong = hasStrongTaxSignal(right.title) ? 0 : 1;
          if (leftStrong !== rightStrong) return leftStrong - rightStrong;
          const leftDirect = isTaxRelated(left.title) ? 0 : 1;
          const rightDirect = isTaxRelated(right.title) ? 0 : 1;
          if (leftDirect !== rightDirect) return leftDirect - rightDirect;
          return String(right.publishedAt || right.discoveredAt).localeCompare(String(left.publishedAt || left.discoveredAt));
        });
      const reserved = [];
      const reservedIds = new Set();
      const judicialCandidate = prioritizedQueue.find((candidate) => /^trf[1-6]$/.test(candidate.sourceId) && hasCandidateText(candidate)
        && /inteiro teor|acórdão|decisão|julgamento/i.test(candidate.documentKind))
        || prioritizedQueue.find((candidate) => /inteiro teor|acórdão|decisão|julgamento/i.test(candidate.documentKind));
      if (judicialCandidate) {
        reserved.push(judicialCandidate);
        reservedIds.add(judicialCandidate.id);
      }
      const receitaCandidate = prioritizedQueue.find((candidate) => ['receita-cosit', 'receita-in', 'receita-notas'].includes(candidate.sourceId));
      if (receitaCandidate && reserved.length < config.monitorMaxAnalyses) {
        reserved.push(receitaCandidate);
        reservedIds.add(receitaCandidate.id);
      }
      // Preserva as curadorias quando há vagas, sem bloquear a fila judicial.
      for (const sectionId of ['reforma', 'obrigacoes']) {
        for (const candidate of prioritizedQueue) {
          if (reserved.length >= config.monitorMaxAnalyses || reservedIds.size >= Math.min(4, config.monitorMaxAnalyses)) break;
          if (reservedIds.has(candidate.id) || !candidateSections(candidate).includes(sectionId)) continue;
          reserved.push(candidate);
          reservedIds.add(candidate.id);
          break;
        }
      }
      const queue = [...reserved, ...prioritizedQueue.filter((item) => !reservedIds.has(item.id))]
        .slice(0, config.monitorMaxAnalyses);
      for (const candidate of queue) {
        runtime.currentSource = candidate.sourceAcronym;
        runtime.currentDocument = candidate.title;
        const wasFastPublished = candidate.status === 'fast-published' && Boolean(candidate.alertId);
        try {
          await updateDatabase((data) => ({ ...data, monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: 'analyzing', attempts: item.attempts + 1 } : item) } }));
          const inlineText = unpackCandidateText(candidate);
          const collected = inlineText
            ? { url: candidate.url, title: candidate.title, text: inlineText, characters: inlineText.length, contentType: 'text/plain', publishedAt: candidate.publishedAt, parser: candidate.inlineParser || 'Consulta oficial estruturada' }
            : candidate.sourceId.startsWith('custom-')
              ? await collectPublicSourceDocument(candidate.collectionUrl || candidate.url)
              : await collectOfficialPage(candidate.collectionUrl || candidate.url);
          const document = {
            ...collected,
            candidateTitle: candidate.title,
            documentKind: candidate.documentKind,
            sourceName: candidate.sourceName,
            sections: candidateSections(candidate),
            sourceType: candidate.sourceType || 'official',
            policyAssessment: candidate.fastTriage?.policy || assessTaxIntelligenceCandidate({ ...candidate, content: inlineText }),
          };
          if (document.characters < 200) throw new Error('Documento sem texto suficiente.');
          const analysis = await analyzeDocument(document);
          const latestDatabase = await readDatabase();
          const existingAlert = wasFastPublished
            ? latestDatabase.alerts.find((item) => item.id === candidate.alertId) || null
            : null;
          const alert = makeAlert(analysis, document, candidate, existingAlert);
          const excludedTopic = isExcludedTaxTopic(
            candidate.title, candidate.url, document.text, alert.title, alert.summary,
            alert.whatChanged, alert.practicalImpact, alert.theme, alert.taxes,
          );
          const policy = candidate.fastTriage?.policy || assessTaxIntelligenceCandidate({ ...candidate, content: document.text });
          const primarySourceVerified = (candidate.sourceType || 'official') === 'official';
          const highPriorityConfirmed = policy.eligible
            && policy.concreteEvent
            && (policy.priorityOneTopics.length > 0 || policy.businessEffect)
            && alert.score >= 8;
          const isBusinessActionable = analysis.businessActionable || highPriorityConfirmed;
          const isRelevant = analysis.relevant || highPriorityConfirmed;
          const qualityAssessment = assessAlertAnalysisQuality(alert);
          const passesEditorialGate = policy.eligible
            && policy.concreteEvent
            && (policy.priorityOneTopics.length > 0 || policy.businessEffect)
            && (analysis.contentNature !== 'Opinião ou conteúdo sem fato novo' || highPriorityConfirmed)
            && isBusinessActionable
            && (analysis.noveltyType !== 'Sem novidade concreta' || highPriorityConfirmed)
            && ((analysis.relevanceReasons && analysis.relevanceReasons.length > 0) || highPriorityConfirmed)
            && qualityAssessment.passed;
          const publish = !excludedTopic && primarySourceVerified && passesEditorialGate && isRelevant && alert.score >= 6
            && (targetDate ? publicationDateKey(alert.publishedAt) === targetDate : isPublishedWithinDays(alert.publishedAt, config.monitorLookbackDays));
          const discardReason = publish ? null
            : excludedTopic ? 'Tema Simples Nacional excluído por regra editorial.'
              : !primarySourceVerified ? 'Fonte secundária sem documento oficial primário resolvido.'
                : !policy.eligible ? policy.exclusionReason || 'Tema fora da matriz de inteligência tributária empresarial.'
                  : !passesEditorialGate ? 'Sem fato novo e providência empresarial concreta.'
                    : !analysis.relevant ? 'A análise detalhada classificou o documento como não relevante.'
              : alert.score < 6 ? `Nota ${alert.score} inferior ao mínimo editorial 6.`
                : 'Data de publicação fora da janela de hoje e ontem.';
          await updateDatabase((data) => ({
            ...data,
            alerts: publish
              ? existingAlert
                ? data.alerts.map((item) => item.id === alert.id ? alert : item)
                : [alert, ...data.alerts]
              : wasFastPublished
                ? data.alerts.filter((item) => item.id !== candidate.alertId)
                : data.alerts,
            meta: publish ? { ...data.meta, lastUpdatedAt: new Date().toISOString() } : data.meta,
            monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: publish ? 'analyzed' : 'discarded', analyzedAt: new Date().toISOString(), analyzedPublishedAt: analysis.publishedAt || null, relevant: analysis.relevant, score: alert.score, discardReason, alertId: publish ? alert.id : null, analysisMode: 'ollama', detailedAnalysisPending: false } : item) },
          }));
          run.analyzed += 1;
          if (publish && !wasFastPublished) run.published += 1; else if (!publish) run.discarded += 1;
        } catch (error) {
          run.errors += 1;
          await updateDatabase((data) => ({ ...data, monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: wasFastPublished ? 'fast-published' : 'error', error: error.message, analyzedAt: new Date().toISOString() } : item) } }));
        }
      }
    }

    run.finishedAt = new Date().toISOString();
    const nextRunAt = new Date(Date.now() + config.monitorIntervalMinutes * 60000).toISOString();
    await updateDatabase((database) => ({ ...database, monitor: { ...monitorData(database), runs: [run, ...monitorData(database).runs].slice(0, 100), lastRunAt: run.finishedAt, nextRunAt } }));
    return { accepted: true, run };
  } catch (error) {
    runtime.error = error.message;
    throw error;
  } finally {
    runtime.running = false;
    runtime.phase = 'idle';
    runtime.currentSource = null;
    runtime.currentDocument = null;
  }
}

export function startMonitor() {
  if (!config.monitorEnabled || timer) return;
  setTimeout(() => runMonitor({ trigger: 'startup' }).catch((error) => console.error('Falha na varredura inicial:', error.message)), config.monitorInitialDelayMs).unref();
  timer = setInterval(() => runMonitor({ trigger: 'schedule' }).catch((error) => console.error('Falha na varredura agendada:', error.message)), config.monitorIntervalMinutes * 60000);
  timer.unref();
}

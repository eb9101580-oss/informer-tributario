import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { monitoredSources } from '../data/officialSources.js';
import { collectOfficialPage } from './collector.js';
import { analyzeDocument } from './ollama.js';
import { calculateScore, relevanceLabel } from './scoring.js';
import { discoverSourceCandidates, hasStrongTaxSignal, isCandidateEligible, isTaxRelated, sourceDateCoverage } from './sourceAdapters.js';
import { readDatabase, updateDatabase } from './store.js';
import { sectionIdsForSource } from '../data/sections.js';
import { isPublishedWithinDays, publicationDateKey } from './feedWindow.js';
import { hasCandidateText, unpackCandidateText } from './candidateText.js';

const runtime = { running: false, phase: 'idle', currentSource: null, currentDocument: null, startedAt: null, error: null };
let timer;

export function monitorData(database) {
  return database.monitor || { candidates: [], runs: [], lastRunAt: null, nextRunAt: null };
}

export function candidateId(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export function candidateFingerprint(candidate) {
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
  return {
    ...(existingAlert || {}), ...analysis, id: existingAlert?.id || randomUUID(), score, relevance: relevanceLabel(score), officialUrl: candidate.url,
    publishedAt: candidate.publishedAt || document.publishedAt || analyzedPublishedAt,
    isDemo: false, createdAt: existingAlert?.createdAt || now, updatedAt: now,
    provenance: {
      ...(existingAlert?.provenance || {}),
      analysisMode: 'ollama', detailedAnalysisPending: false,
      collector: hasCandidateText(candidate) ? (candidate.inlineParser || 'Consulta oficial estruturada') : 'Scrapling', analyzer: `Triagem rápida/regras + ${config.analysisProvider}/${config.ollamaModel}`, collectorUrl: candidate.collectionUrl || candidate.url, sourceCharacters: document.characters,
      sourceId: candidate.sourceId, sourceName: candidate.sourceName, discoveredBy: candidate.discoveryMethod,
      sourceType: candidate.sourceType || 'official',
      documentKind: candidate.documentKind, discoveredAt: candidate.discoveredAt,
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
  const text = `${candidate.title || ''} ${candidate.documentKind || ''}`;
  const signals = [];
  let score = 0;
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
  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    band: boundedScore >= 70 ? 'alta' : boundedScore >= 45 ? 'media' : 'baixa',
    signals,
    engine: 'regras-tributarias-v1',
  };
}

const FAST_TAXES = [
  ['ICMS', /\bicms\b/i], ['ISS', /\biss(?:qn)?\b/i], ['IPI', /\bipi\b/i], ['PIS', /\bpis\b/i],
  ['Cofins', /cofins?/i], ['IRPJ', /irpj/i], ['IRPF', /irpf/i], ['IRRF', /irrf/i], ['CSLL', /csll/i],
  ['CBS', /\bcbs\b/i], ['IBS', /\bibs\b/i], ['IPTU', /\biptu\b/i], ['IPVA', /\bipva\b/i],
  ['ITBI', /\bitbi\b/i], ['Simples Nacional', /simples nacional/i], ['CPRB', /cprb/i], ['FUNRURAL', /funrural/i],
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
  const text = unpackCandidateText(candidate).slice(0, 12000).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length >= 45);
  return shortenFastText(sentences.find((sentence) => hasStrongTaxSignal(sentence) || MERIT_PATTERN.test(sentence)) || sentences[0] || text, 420);
}

export function canFastPublishCandidate(candidate) {
  const triage = candidate.fastTriage || fastTriageCandidate(candidate);
  const structured = STRUCTURED_ADAPTERS.has(candidate.discoveryMethod) || OPERATIONAL_SOURCES.has(candidate.sourceId);
  return (candidate.sourceType || 'official') === 'official'
    && triage.score >= 70
    && structured
    && isCandidateEligible(candidate.sourceId, candidate.title, candidate.url);
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
  return {
    relevant: true,
    title,
    theme: taxes.length ? `Direito tributário · ${taxes.join(', ')}` : 'Direito tributário',
    agency: sourceName,
    taxes,
    status: 'Fato confirmado',
    kind,
    impactType: 'Informativo',
    publishedAt: candidate.publishedAt || now,
    summary: `A ${sourceName} publicou ${kind.toLowerCase()}${date ? ` em ${date}` : ''}. ${evidence || 'O registro oficial foi identificado no monitoramento tributário.'}`,
    whatChanged: 'A publicação foi identificada em fonte oficial e entrou no feed por triagem automática. O alcance, a vigência e o efeito jurídico devem ser conferidos no inteiro teor.',
    practicalImpact: 'O item pode afetar a análise tributária do tema indicado. Este resumo é factual e não substitui a leitura da decisão, norma ou certidão oficial.',
    officeAction: 'Abrir a fonte oficial, conferir dispositivo, vigência, processo e destinatários antes de orientar o cliente.',
    affectedProfiles: ['Contribuintes e empresas do tema indicado'],
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
  return { ...runtime, enabled: config.monitorEnabled, intervalMinutes: config.monitorIntervalMinutes, maxAnalysesPerRun: config.monitorMaxAnalyses };
}

export async function getMonitorSnapshot() {
  const database = await readDatabase();
  const monitor = monitorData(database);
  return {
    runtime: getMonitorRuntime(), lastRunAt: monitor.lastRunAt, nextRunAt: monitor.nextRunAt,
    queued: monitor.candidates.filter((item) => item.status === 'pending').length,
    fastPublished: monitor.candidates.filter((item) => item.status === 'fast-published').length,
    analyzed: monitor.candidates.filter((item) => item.status === 'analyzed').length,
    discarded: monitor.candidates.filter((item) => item.status === 'discarded').length,
    errors: monitor.candidates.filter((item) => item.status === 'error').length,
    sources: monitoredSources.length,
  };
}

export async function runMonitor({ analyze = true, trigger = 'manual', targetDate: rawTargetDate = null } = {}) {
  const targetDate = normalizeMonitorTargetDate(rawTargetDate);
  if (runtime.running) return { accepted: false, message: 'Já existe uma varredura em andamento.' };
  runtime.running = true;
  runtime.phase = 'discovery';
  runtime.startedAt = new Date().toISOString();
  runtime.error = null;
  const run = { id: randomUUID(), trigger, targetDate, startedAt: runtime.startedAt, finishedAt: null, discovered: 0, analyzed: 0, published: 0, discarded: 0, errors: 0, sources: [] };

  try {
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
    const results = await mapWithConcurrency(monitoredSources, 3, async (source) => {
      runtime.currentSource = source.acronym;
      return { source, items: await discoverSourceCandidates(source, config.monitorLookbackDays, { targetDate }) };
    });
    const found = [];
    results.forEach((result, index) => {
      const source = monitoredSources[index];
      if (result.status === 'fulfilled') {
        found.push(...result.value.items);
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'ok', found: result.value.items.length, dateCoverage: targetDate ? sourceDateCoverage(source) : null, ...(result.value.items.discoveryTelemetry ? { telemetry: result.value.items.discoveryTelemetry } : {}) });
      } else {
        run.errors += 1;
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'error', found: 0, message: result.reason?.message || 'Falha na fonte' });
      }
    });

    await updateDatabase((database) => {
      const monitor = monitorData(database);
      const publishedFingerprints = new Set(monitor.candidates.filter((item) => ['analyzed', 'fast-published'].includes(item.status)).map(candidateFingerprint));
      const pendingFingerprints = new Set();
      const retained = monitor.candidates.filter((item) => {
        if (['pending', 'error'].includes(item.status) && !isCandidateEligible(item.sourceId, item.title, item.url)) return false;
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
        return [{ ...item, id, status: 'pending', attempts: 0, backfillDate: targetDate || null, fastTriage: fastTriageCandidate(item) }];
      });
      run.discovered = additions.length;
      const sourceRank = (item) => ['stf', 'stj', 'stj-informativos', 'stf-informativos', 'carf', 'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'trf6'].includes(item.sourceId) ? 0 : ['receita-federal', 'receita-cosit', 'receita-in', 'receita-notas', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'diario-oficial', 'pgfn-pareceres'].includes(item.sourceId) ? 1 : 2;
      additions.sort((left, right) => sourceRank(left) - sourceRank(right));
      return { ...database, monitor: { ...monitor, candidates: [...additions, ...retained].slice(0, 20000) } };
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

    if (analyze && config.monitorMaxAnalyses > 0) {
      runtime.phase = 'analysis';
      const database = await readDatabase();
      const prioritizedQueue = monitorData(database).candidates
        .filter((item) => item.status === 'pending' || item.status === 'fast-published' || (item.status === 'error' && item.attempts < 3))
        .filter((item) => targetDate
          ? item.backfillDate === targetDate || publicationDateKey(item.publishedAt) === targetDate
          : isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays))
        .map((item) => ({ ...item, fastTriage: item.fastTriage || fastTriageCandidate(item) }))
        .sort((left, right) => {
          if (left.fastTriage.score !== right.fastTriage.score) return right.fastTriage.score - left.fastTriage.score;
          const leftFreshness = freshnessRank(left);
          const rightFreshness = freshnessRank(right);
          if (leftFreshness !== rightFreshness) return leftFreshness - rightFreshness;
          const leftDecision = /inteiro teor|acórdão|decisão/i.test(left.documentKind) ? 0 : 1;
          const rightDecision = /inteiro teor|acórdão|decisão/i.test(right.documentKind) ? 0 : 1;
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
        && /inteiro teor|acórdão|decisão/i.test(candidate.documentKind))
        || prioritizedQueue.find((candidate) => /inteiro teor|acórdão|decisão/i.test(candidate.documentKind));
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
            : await collectOfficialPage(candidate.collectionUrl || candidate.url);
          const document = {
            ...collected,
            candidateTitle: candidate.title,
            documentKind: candidate.documentKind,
            sourceName: candidate.sourceName,
            sections: candidateSections(candidate),
          };
          if (document.characters < 200) throw new Error('Documento sem texto suficiente.');
          const analysis = await analyzeDocument(document);
          const latestDatabase = await readDatabase();
          const existingAlert = wasFastPublished
            ? latestDatabase.alerts.find((item) => item.id === candidate.alertId) || null
            : null;
          const alert = makeAlert(analysis, document, candidate, existingAlert);
          const publish = analysis.relevant && alert.score >= 6
            && (targetDate ? publicationDateKey(alert.publishedAt) === targetDate : isPublishedWithinDays(alert.publishedAt, config.monitorLookbackDays));
          const discardReason = publish ? null
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

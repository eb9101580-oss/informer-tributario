import { discoverDjenCaderno, discoverOfficialLinks, discoverStfJurisprudence } from './collector.js';
import { sectionIdsForSource } from '../data/sections.js';
import { publicationDateKey } from './feedWindow.js';
import { packCandidateText } from './candidateText.js';
import { discoverPublicSourceLinks } from './sourceSafety.js';
import { assessTaxIntelligenceCandidate, candidatePassesHardPolicy } from './taxIntelligencePolicy.js';

const TAX_TERMS = [
  'tribut', 'imposto', 'contribuicao previdenciaria', 'contribuicao social', 'contribuicoes sociais', 'credito fiscal', 'credito tributario', 'debito fiscal',
  'icms', 'iss', 'ipi', 'pis', 'pasep', 'cofins', 'irpj', 'irrf', 'csll', 'cbs', 'ibs', 'iof', 'cide', 'funrural', 'afrmm',
  'iptu empresarial', 'ipva de frota empresarial', 'itcmd em reorganizacao societaria', 'itbi na integralizacao de capital', 'itbi em reorganizacao societaria',
  'compensacao tributaria', 'compensacao de tributos', 'parcelamento tributario', 'beneficio fiscal', 'transacao tributaria', 'autorregularizacao incentivada',
  'imposto de importacao', 'imposto de exportacao', 'tributacao na importacao', 'tributacao na exportacao', 'regime aduaneiro', 'despacho aduaneiro', 'aduaneir',
  'imunidade tributaria', 'isencao tributaria', 'isencao fiscal', 'repeticao de indebito tributario', 'indebito tributario', 'taxa tributaria', 'taxa de fiscalizacao', 'taxa selic', 'emprestimo compulsorio',
  'imposto seletivo', 'reforma tributaria', 'cgibs', 'split payment', 'apuracao assistida', 'aliquota de referencia', 'regime diferenciado', 'regime especifico',
  'nao cumulatividade', 'apropriacao de creditos', 'estorno de creditos', 'ressarcimento de creditos', 'saldo credor', 'periodo de transicao',
  'conceito de insumo', 'credito extemporaneo', 'creditos extemporaneos', 'credito presumido', 'creditos presumidos', 'tese do seculo',
  'pedido de restituicao', 'pedido de ressarcimento', 'declaracao de compensacao', 'habilitacao de credito', 'nao homologacao', 'despacho decisorio',
  'manifestacao de inconformidade', 'saldo negativo de irpj', 'saldo negativo de csll', 'pagamento indevido', 'pagamento a maior',
  'lucro real', 'lucro presumido', 'prejuizo fiscal', 'base negativa de csll', 'limite de compensacao de 30', 'subvencao', 'subvencoes', 'agio', 'ganho de capital',
  'depreciacao fiscal', 'amortizacao fiscal', 'juros sobre capital proprio', 'jcp', 'distribuicao de dividendos', 'tributacao de dividendos', 'tributacao minima de altas rendas', 'distribuicao desproporcional',
  'retencao na fonte', 'retencoes tributarias', 'pis retido', 'pasep retido', 'cofins retida', 'csll retida', 'inss retido',
  'nota fiscal eletronica', 'sped', 'obrigacao acessoria', 'efd contribuicoes', 'efd icms ipi', 'efd reinf', 'dctfweb',
  'modulo de inclusao de tributos', 'esocial', 'nfs-e', 'ct-e', 'regra de validacao', 'guia pratico', 'malha fiscal',
  'substituicao tributaria', 'icms-st', 'difal', 'transferencia de creditos', 'transferencia entre estabelecimentos', 'ciap',
  'convenio icms', 'ajuste sinief', 'protocolo icms', 'ato cotepe',
  'duimp', 'siscomex', 'classificacao fiscal', 'ncm', 'valoracao aduaneira', 'drawback', 'recof', 'recof-sped', 'reintegra',
  'planejamento tributario', 'elisao fiscal', 'proposito negocial', 'substancia economica', 'reorganizacao societaria', 'negocio juridico indireto',
  'voto de qualidade', 'sumula carf', 'resolucao de divergencia', 'processo administrativo tributario', 'multa de oficio', 'multa isolada', 'denuncia espontanea',
  'novo edital de transacao', 'programa de conformidade tributaria', 'precos de transferencia', 'tributacao minima global', 'dupla tributacao',
  'lucros no exterior', 'controladas e coligadas', 'royalties', 'importacao de servicos', 'pagamento ao exterior', 'pagamentos ao exterior',
  'fato gerador', 'auto de infracao', 'processo administrativo fiscal', 'lancamento fiscal', 'contencioso fiscal',
];
const SHORT_TAX_TERMS = new Set(['icms', 'iss', 'ipi', 'pis', 'pasep', 'cofins', 'irpj', 'irrf', 'csll', 'cbs', 'ibs', 'iof', 'cide', 'funrural', 'afrmm', 'jcp', 'ncm', 'duimp', 'siscomex', 'drawback', 'recof', 'reintegra']);
const TAX_TOPIC_PATTERNS = [
  /\bper\s*\/?\s*dcomp(?:\s+web)?\b/,
  /\b(?:lc|lei complementar)\s*(?:n(?:\.\s*)?[\u00ba\u00b0o]?\s*)?(?:214\/2025|227\/2026)\b/,
  /\blei\s*(?:n(?:\.\s*)?[\u00ba\u00b0o]?\s*)?(?:10\.637\/2002|10\.833\/2003|9\.718\/1998|9\.430\/1996|14\.596\/2023|15\.270\/2025)\b/,
  /\bin\s*rfb\s*(?:n(?:\.\s*)?[\u00ba\u00b0o]?\s*)?(?:2\.121\/2022|2\.055\/2021)\b/,
  /\bart\.?\s*170-a\s+do\s+ctn\b/,
  /\b(?:dctf[\s-]*web\b.{0,40}\bmit\b|\bmit\b.{0,40}\bdctf[\s-]*web\b|modulo de inclusao de tributos)\b/,
  /\bjcp\b/,
  /\befd[\s-]*(?:contribuicoes|icms[\s/-]*ipi|reinf)\b/,
  /\bnf[\s-]*e\b|\bnfs[\s-]*e\b|\bct[\s-]*e\b/,
  /\bpilar\s*(?:2|dois)\b/,
  /\bprecos?\s+de\s+transferencia\b/,
];
const TRIBUTARY_WORD_PATTERN = /\btribut(?:os?|ar|ad[oa]s?|acao|acoes|ari[oa]s?|avel|aveis)\b/i;

function matchesTaxVocabulary(text) {
  return TAX_TOPIC_PATTERNS.some((pattern) => pattern.test(text)) || TAX_TERMS.filter((term) => term !== 'tribut').some((term) => SHORT_TAX_TERMS.has(term)
    ? new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`, 'i').test(text)
    : text.includes(term));
}

export function normalizeSearchText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isExcludedTaxTopic(...values) {
  const text = normalizeSearchText(values.flat().filter(Boolean).join(' '));
  if (!/\bsimples[\s-]+nacional\b/.test(text)) return false;
  return Boolean(assessTaxIntelligenceCandidate({ title: text, content: text }).exclusionReason);
}

export function isTaxRelated(...values) {
  const text = normalizeSearchText(values.flat().filter(Boolean).join(' '));
  return TRIBUTARY_WORD_PATTERN.test(text) || matchesTaxVocabulary(text);
}

export function hasStrongTaxSignal(...values) {
  const text = normalizeSearchText(values.flat().filter(Boolean).join(' '));
  return matchesTaxVocabulary(text) || /direito tributario|sistema tributario|materia tributaria/.test(text);
}

export function isCandidateEligible(sourceId, title, url, content = '') {
  if (!candidatePassesHardPolicy({ sourceId, title, url, content, sourceType: 'official' })) return false;
  if (/#[^/]*$/.test(url) || /^ir para\b/i.test(title)) return false;
  if (/^trf[1-6]$/.test(sourceId)) {
    const navigationPath = /\/(?:acessibilidade|contato|institucional|magistrado|servicos?|sistemas?)(?:\/|$)/i;
    if (navigationPath.test(new URL(url).pathname)) return false;
    const titleWithoutClassifier = String(title || '').replace(/[—-]\s*direito tribut[aá]rio\s*:\s*/i, ' ');
    return isTaxRelated(content || titleWithoutClassifier, url);
  }
  if (sourceId === 'confaz-ajustes') return /\/ajustes\/\d{4}\/[^/]+/i.test(url) && /ajuste|sinief|ato cotepe|conv[eê]nio|documento fiscal|leiaute/i.test(title);
  if (sourceId === 'diario-oficial') return /portaria|lei|decreto|instru[cç][aã]o normativa|ato declarat[oó]rio|despacho|conv[eê]nio|tribut|imposto|contribui/i.test(`${title} ${url}`);
  if (['reforma-cgibs', 'reforma-portal', 'reforma-folha', 'reforma-valor'].includes(sourceId)) {
    if (/\/assinatura(?:\/|$)|\/assine(?:\/|$)|\/login(?:\/|$)|paywall|newsletter/i.test(url)) return false;
    return /reforma|ibs|cbs|imposto seletivo|documento fiscal|nota t[eé]cnica|regulamenta|tribut/i.test(`${title} ${url}`);
  }
  if (sourceId === 'sped-notas-tecnicas') return /manual|manu[aá]i|leiaute|layout|nota t[eé]cnica|orienta|vers[aã]o|tabela|atualiz|ecd|ecf|efd|reinf|esocial|financeira|dere/i.test(`${title} ${url}`);
  if (sourceId === 'sped-dere') return /\bdere\b|declara[cç][aã]o de regimes especiais|manual|leiaute|nota t[eé]cnica|orienta|vers[aã]o/i.test(`${title} ${url}`);
  if (['sped-ecd', 'sped-ecf', 'sped-efd-contribuicoes', 'sped-efd-icms-ipi', 'sped-efd-reinf', 'sped-e-financeira', 'sped-esocial', 'sped-central-balancos', 'sped-dere'].includes(sourceId)) {
    const moduleTerms = {
      'sped-ecd': /\becd\b|escritura[cç][aã]o cont[aá]bil/i,
      'sped-ecf': /\becf\b|escritura[cç][aã]o cont[aá]bil fiscal/i,
      'sped-efd-contribuicoes': /efd.?contribui[cç][oõ]es|contribui[cç][oõ]es|pis|cofins/i,
      'sped-efd-icms-ipi': /efd.?icms|icms|ipi/i,
      'sped-efd-reinf': /reinf/i,
      'sped-e-financeira': /e.?financeira|financeira/i,
      'sped-esocial': /esocial/i,
      'sped-central-balancos': /central.{0,12}balan[cç]os|balan[cç]os/i,
      'sped-dere': /\bdere\b|regimes espec[ií]ficos/i,
    }[sourceId];
    const text = `${title} ${url}`;
    return moduleTerms.test(text) && /manual|manu[aá]i|leiaute|layout|nota t[eé]cnica|orienta|vers[aã]o|tabela|atualiz|documenta[cç][aã]o|programa/i.test(text);
  }
  if (['receita-cosit', 'receita-in', 'receita-notas'].includes(sourceId)) {
    const sourceText = normalizeSearchText(title);
    const isNormasLink = /normas(?:internet2)?\.receita\.fazenda\.gov\.br/i.test(url) && /consulta\/externa|link\.action/i.test(url);
    if (!isNormasLink) return false;
    if (sourceId === 'receita-cosit') return /cosit|solucao de consulta|solucao de divergencia/.test(sourceText);
    if (sourceId === 'receita-in') {
      // O tipo do ato aparece no início do resultado. Procurá-lo na ementa
      // inteira faria uma simples habilitação virar "Instrução Normativa"
      // apenas porque ela cita uma IN como fundamento.
      if (/^(?:instrucao normativa|ato declaratorio interpretativo|portaria conjunta|ato conjunto|resolucao|decreto|lei)\b/.test(sourceText)) return true;
      const hasNormativeEffect = /altera|aprova (?:manual|leiaute|layout|norma)|disciplina|dispoe sobre|estabelece|fixa|institui|prorroga|regulamenta|revoga|suspende/.test(sourceText);
      const individualAct = /certifica|habilita (?:a |uma )?empresa|declara (?:a )?empresa habilitada|inscricao no registro|concede (?:a |para )|fornecimento de selos/.test(sourceText);
      return /ato declaratorio executivo|\bportaria\b/.test(sourceText)
        && hasStrongTaxSignal(sourceText) && hasNormativeEffect && !individualAct;
    }
    return /nota|parecer/.test(sourceText) && hasStrongTaxSignal(sourceText);
  }
  if (sourceId === 'nfe-notas-tecnicas') return /nota|t[eé�]cnica/i.test(title) || /exibirArquivo/i.test(url);
  if (sourceId === 'sped-notas-tecnicas') return /nota|t[eé�]cnica|sped/i.test(title) && isTaxRelated(title);
  if (sourceId === 'stj-informativos') return /informativo|tribut|ac[oó]rd[aã]o|tese/i.test(title) && isTaxRelated(title);
  if (sourceId === 'stf-informativos') return /informativo|tribut|ac[oó]rd[aã]o|tese/i.test(title) && isTaxRelated(title);
  if (sourceId === 'pgfn-pareceres') return /parecer|s[úu�]mula|decis[aã�]o|tribut/i.test(title) && isTaxRelated(title);
  if (!isTaxRelated(title, url)) return false;
  if (sourceId === 'receita-federal') return /\/assuntos\/noticias\/20\d{2}\//i.test(url);
  if (sourceId === 'diario-oficial') return /\/web\/dou\/-\//i.test(url);
  return true;
}

function cleanUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.hostname.includes('normasinternet2.receita.fazenda.gov.br')) url.hash = '';
  return url.toString();
}

export function enrichReceitaNormasCandidate(item) {
  const url = cleanUrl(item.url);
  const match = url.match(/normasinternet2\.receita\.fazenda\.gov\.br\/#\/consulta\/externa\/(\d+)/i);
  if (!match) return { ...item, url };
  const actId = match[1];
  return {
    ...item,
    url: `https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/${actId}`,
    collectionUrl: `https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/${actId}/visao/original`,
    documentKind: 'Ato normativo da Receita Federal',
    externalId: actId,
    fingerprintKey: `receita-normas:${actId}`,
  };
}

const RECEITA_NORMATIVE_TYPES = ['42', '79', '7', '9', '10', '11', '57', '81', '67', '100', '102', '59', '61', '76', '77'];
const CARF_SOLR_URL = 'https://acordaos.economia.gov.br/solr/acordaos2/select';
const CARF_PDF_URL = 'https://acordaos.economia.gov.br/acordaos2/pdfs/processados';

function previousDateKey(dateKey, days = 1) {
  const timestamp = Date.parse(`${dateKey}T12:00:00Z`);
  return new Date(timestamp - days * 86400000).toISOString().slice(0, 10);
}

function formattedBrazilianDate(dateKey) {
  return dateKey.split('-').reverse().join('/');
}

export function structuredDateRange(targetDate = null, now = new Date()) {
  const endDate = targetDate || publicationDateKey(now);
  if (!endDate) throw new Error('Não foi possível determinar a data da consulta estruturada.');
  return { startDate: targetDate ? endDate : previousDateKey(endDate), endDate };
}

export function receitaNormasQueryUrl(sourceId, targetDate = null, now = new Date()) {
  const { startDate, endDate } = structuredDateRange(targetDate, now);
  const params = new URLSearchParams({
    tipoData: '2',
    dt_inicio: formattedBrazilianDate(startDate),
    dt_fim: formattedBrazilianDate(endDate),
    ordemColuna: 'Publicacao',
    ordemDirecao: 'DESC',
  });
  if (sourceId === 'receita-cosit') {
    params.set('tiposAtosSelecionados', '72;73');
    params.set('siglaOrgaoFacet', 'Cosit');
  } else if (sourceId === 'receita-in') {
    params.set('tiposAtosSelecionados', RECEITA_NORMATIVE_TYPES.join(';'));
  }
  return `https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action?${params}`;
}

function receitaDocumentKind(sourceId) {
  if (sourceId === 'receita-cosit') return 'Solução de Consulta ou Divergência COSIT';
  if (sourceId === 'receita-in') return 'Instrução Normativa ou ato da Receita Federal';
  return 'Nota ou parecer normativo da Receita Federal';
}

export function mapReceitaNormasLinks(links, source, dateRange) {
  return links
    .filter((item) => isCandidateEligible(source.id, item.title, item.url))
    .filter((item) => {
      const publishedAt = publicationDateKey(item.publishedAt);
      return publishedAt && publishedAt >= dateRange.startDate && publishedAt <= dateRange.endDate;
    })
    .map((item) => ({
      ...enrichReceitaNormasCandidate(item),
      documentKind: receitaDocumentKind(source.id),
      sections: item.sections || source.sections || sectionIdsForSource(source.id),
    }));
}

async function discoverReceitaNormas(source, targetDate = null) {
  const dateRange = structuredDateRange(targetDate);
  const result = await discoverOfficialLinks(receitaNormasQueryUrl(source.id, targetDate));
  return mapReceitaNormasLinks(result.links || [], source, dateRange);
}

export function carfSolrQueryUrl(targetDate = null, now = new Date(), rows = 200) {
  const { startDate, endDate } = structuredDateRange(targetDate, now);
  const params = new URLSearchParams({
    q: '*:*',
    fq: `dt_publicacao_tdt:[${startDate}T00:00:00Z TO ${endDate}T23:59:59Z]`,
    sort: 'dt_publicacao_tdt desc,id desc',
    rows: String(Math.min(200, Math.max(1, Number(rows) || 200))),
    wt: 'json',
    fl: 'id,dt_publicacao_tdt,dt_sessao_tdt,dt_index_tdt,materia_s,ementa_s,decisao_txt,numero_processo_s,numero_decisao_s,nome_relator_s,turma_s,camara_s,secao_s,nome_arquivo_pdf_s',
  });
  return `${CARF_SOLR_URL}?${params}`;
}

function joinedCarfValue(value) {
  return (Array.isArray(value) ? value : [value]).filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
}

function validCarfPublicationDate(value, now = new Date()) {
  const dateKey = publicationDateKey(value);
  if (!dateKey) return '';
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) return '';
  const year = Number(dateKey.slice(0, 4));
  const currentYear = Number(publicationDateKey(now)?.slice(0, 4));
  return year >= 2000 && year <= currentYear + 1 ? dateKey : '';
}

function validCarfPdfFilename(value) {
  const filename = joinedCarfValue(value);
  return /^[a-z0-9_.-]+\.pdf$/i.test(filename) && !filename.includes('..') ? filename : '';
}

export function mapCarfDecisions(payload, dateRange = {}, now = new Date()) {
  const docs = Array.isArray(payload) ? payload : payload?.response?.docs || [];
  const seen = new Set();
  return docs.flatMap((item) => {
    const publishedAt = validCarfPublicationDate(item.dt_publicacao_tdt, now);
    const filename = validCarfPdfFilename(item.nome_arquivo_pdf_s);
    if (!publishedAt || !filename
      || (dateRange.startDate && publishedAt < dateRange.startDate)
      || (dateRange.endDate && publishedAt > dateRange.endDate)) return [];
    const decisionNumber = joinedCarfValue(item.numero_decisao_s);
    const processNumber = joinedCarfValue(item.numero_processo_s);
    const externalId = joinedCarfValue(item.id) || [decisionNumber, processNumber].filter(Boolean).join(':');
    if (!externalId || seen.has(externalId)) return [];
    seen.add(externalId);
    const summary = joinedCarfValue(item.ementa_s);
    const decision = joinedCarfValue(item.decisao_txt);
    const matter = joinedCarfValue(item.materia_s) || summary.split(/\n|\.(?:\s|$)/)[0];
    const title = [
      `Acórdão CARF ${decisionNumber || externalId}`,
      processNumber ? `Processo ${processNumber}` : '',
      matter,
    ].filter(Boolean).join(' · ').slice(0, 500);
    const officialText = [
      title,
      joinedCarfValue(item.secao_s),
      joinedCarfValue(item.camara_s),
      joinedCarfValue(item.turma_s),
      joinedCarfValue(item.nome_relator_s) ? `Relator: ${joinedCarfValue(item.nome_relator_s)}` : '',
      summary ? `Ementa: ${summary}` : '',
      decision ? `Decisão: ${decision}` : '',
    ].filter(Boolean).join('\n\n');
    return [{
      title,
      url: `${CARF_PDF_URL}/${encodeURIComponent(filename)}`,
      publishedAt,
      documentKind: 'Acórdão do CARF',
      externalId,
      fingerprintKey: `carf:${externalId}`,
      ...packCandidateText(officialText),
      inlineParser: 'Índice público oficial do CARF',
    }];
  });
}

async function discoverCarf(_source, targetDate = null) {
  const dateRange = structuredDateRange(targetDate);
  const payload = await fetchJson(carfSolrQueryUrl(targetDate), { Accept: 'application/json' });
  return mapCarfDecisions(payload, dateRange);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Fonte respondeu com status ${response.status}.`);
  return response.json();
}

async function discoverCamara(_source, lookbackDays, targetDate = null) {
  const end = targetDate ? new Date(`${targetDate}T12:00:00Z`) : new Date();
  const start = targetDate ? end : new Date(end.getTime() - lookbackDays * 86400000);
  const params = new URLSearchParams({ dataInicio: start.toISOString().slice(0, 10), dataFim: end.toISOString().slice(0, 10), ordem: 'DESC', ordenarPor: 'id', itens: '100' });
  const data = await fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?${params}`, { Accept: 'application/json' });
  const taxItems = (data.dados || []).filter((item) => isTaxRelated(item.ementa, item.siglaTipo));
  return Promise.all(taxItems.map(async (item) => {
    let details = item;
    try {
      const detail = await fetchJson(item.uri || `https://dadosabertos.camara.leg.br/api/v2/proposicoes/${item.id}`, { Accept: 'application/json' });
      details = detail.dados || item;
    } catch { /* A consulta exata já limita a data; o item resumido continua útil. */ }
    return {
      title: `${item.siglaTipo} ${item.numero}/${item.ano} — ${item.ementa}`,
      url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${item.id}`,
      publishedAt: details.dataApresentacao || (targetDate ? `${targetDate}T12:00:00-03:00` : ''),
      documentKind: 'Proposição legislativa', externalId: String(item.id),
    };
  }));
}

function senateItems(data) {
  const items = data?.ListaMateriasAtualizadas?.Materias?.Materia || [];
  return Array.isArray(items) ? items : [items];
}

async function discoverSenado(_source, lookbackDays, targetDate = null) {
  const targetAge = targetDate ? Math.ceil((Date.now() - Date.parse(`${targetDate}T12:00:00Z`)) / 86400000) + 1 : lookbackDays;
  const data = await fetchJson(`https://legis.senado.leg.br/dadosabertos/materia/atualizadas?numdias=${Math.min(30, Math.max(1, targetAge))}`, { Accept: 'application/json' });
  return senateItems(data).flatMap((item) => {
    const identification = item?.IdentificacaoMateria || {};
    const basics = item?.DadosBasicosMateria || {};
    const code = identification.CodigoMateria;
    const label = [identification.SiglaSubtipoMateria, identification.NumeroMateria, identification.AnoMateria].filter(Boolean).join(' ');
    const summary = basics.EmentaMateria || basics.ExplicacaoEmentaMateria || '';
    if (!code || !isTaxRelated(summary, label)) return [];
    return [{ title: `${label} — ${summary}`, url: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${code}`, publishedAt: basics.DataApresentacao || '', documentKind: 'Matéria legislativa', externalId: String(code) }];
  });
}

export function stjPublicationDate(value = '') {
  if (typeof value === 'number' || /^\d{11,}$/.test(String(value).trim())) {
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? '' : publicationDateKey(date);
  }
  const calendarDate = publicationDateKey(value);
  if (calendarDate) return calendarDate;
  const match = String(value).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

const STJ_DAILY_DATASET = 'integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica';

function stjResourceDate(resource = {}) {
  const match = String(resource.name || '').match(/^metadados(\d{4})(\d{2})(\d{2})(?:\.json)?$/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

export function hasStjTaxSubject(value = '') {
  return String(value).split(',').some((path) => /^0*14(?:\.|$)/.test(path.trim()));
}

export function selectStjMetadataResources(resources = [], targetDate = null) {
  const dated = resources
    .filter((item) => item.format?.toUpperCase() === 'JSON' && stjResourceDate(item))
    .map((item) => ({ ...item, publicationDate: stjResourceDate(item) }))
    .sort((left, right) => right.publicationDate.localeCompare(left.publicationDate));
  return targetDate ? dated.filter((item) => item.publicationDate === targetDate).slice(0, 1) : dated.slice(0, 1);
}

function stjMetadataItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['documentos', 'items', 'dados']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export function mapStjDailyDecisions(payload, resourceDate) {
  const seen = new Set();
  return stjMetadataItems(payload).flatMap((item) => {
    if (!hasStjTaxSubject(item.assuntos)) return [];
    const publishedAt = stjPublicationDate(item.dataPublicacao) || resourceDate;
    if (!publishedAt || publishedAt !== resourceDate) return [];
    const registration = String(item.numeroRegistro || '').replace(/\D/g, '');
    if (!registration) return [];
    const params = new URLSearchParams({ num_registro: registration, dt_publicacao: publishedAt.split('-').reverse().join('/') });
    const url = `https://processo.stj.jus.br/SCON/GetInteiroTeorDoAcordao?${params}`;
    if (seen.has(url)) return [];
    seen.add(url);
    const type = String(item.tipoDocumento || 'Decisão').replace(/\s+/g, ' ').trim();
    const process = String(item.processo || item.numeroRegistro || 'Processo').replace(/\s+/g, ' ').trim();
    const outcome = String(item.teor || '').replace(/\s+/g, ' ').trim();
    const minister = String(item.NM_MINISTRO || '').replace(/\s+/g, ' ').trim();
    return [{
      title: [type, process, outcome, minister].filter(Boolean).join(' · ').slice(0, 300),
      url,
      publishedAt,
      documentKind: /ac[oó]rd[aã]o/i.test(type) ? 'Inteiro teor de acórdão' : 'Inteiro teor de decisão terminativa',
      externalId: String(item.SeqDocumento || item.numeroRegistro),
      fingerprintKey: `stj-djen:${item.SeqDocumento || `${registration}:${publishedAt}`}`,
    }];
  });
}

async function discoverStj(_source, _lookbackDays, targetDate = null) {
  const packageData = await fetchJson(`https://dadosabertos.web.stj.jus.br/api/3/action/package_show?id=${STJ_DAILY_DATASET}`);
  const resources = selectStjMetadataResources(packageData.result?.resources || [], targetDate);
  if (!resources.length) return [];
  const collections = await Promise.all(resources.map(async (resource) => mapStjDailyDecisions(await fetchJson(resource.url), resource.publicationDate)));
  return collections.flat();
}

const DJEN_API = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const DJEN_DECISION_PATTERN = /ac[oó]rd[aã]o|decis[aã]o|senten[cç]a|julgamento|voto|liminar|tutela/i;

export function isDjenDecision(item = {}) {
  return DJEN_DECISION_PATTERN.test(`${item.tipoDocumento || ''} ${item.tipoComunicacao || ''}`);
}

function djenTaxContext(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const match = text.match(/.{0,90}(?:tribut[aá]ri|execu[cç][aã]o fiscal|cr[eé]dito fiscal|imposto|\bicms\b|\biss\b|\bipi\b|\bpis\b|cofins|irpj|csll|\bcbs\b|\bibs\b).{0,180}/i);
  return (match?.[0] || text.slice(0, 270)).trim();
}

function djenDisplayKind(value = '') {
  const kind = String(value || '').replace(/\s+/g, ' ').trim();
  return /^senten[cç]a\s+tipo\s+[a-z0-9]+(?:\b|$)/i.test(kind) ? 'Sentença' : (kind || 'Decisão');
}

export function mapDjenDecisions(payload, source, targetDate) {
  const seen = new Set();
  return (payload?.items || []).flatMap((item) => {
    const publishedAt = publicationDateKey(item.data_disponibilizacao || item.datadisponibilizacao);
    const officialText = String(item.texto || '').replace(/\s+/g, ' ').trim();
    if (!isDjenDecision(item) || !publishedAt || (targetDate && publishedAt !== targetDate) || !isTaxRelated(officialText)) return [];
    const externalId = String(item.id || item.numeroComunicacao || item.hash || '');
    if (!externalId || seen.has(externalId)) return [];
    seen.add(externalId);
    const process = item.numeroprocessocommascara || item.numero_processo || 'Processo sem número';
    const kind = String(item.tipoDocumento || item.tipoComunicacao || 'Decisão').replace(/\s+/g, ' ').trim();
    const displayKind = djenDisplayKind(kind);
    const certificateUrl = item.hash ? `${DJEN_API}/${encodeURIComponent(item.hash)}/certidao` : item.link;
    if (!certificateUrl?.startsWith('https://')) return [];
    return [{
      title: `${displayKind} · ${process} · ${item.nomeOrgao || source.acronym} — Direito tributário: ${djenTaxContext(officialText)}`.slice(0, 500),
      url: certificateUrl,
      publishedAt,
      documentKind: `${displayKind} judicial publicada no DJEN`,
      sourceDocumentType: kind,
      externalId,
      fingerprintKey: `djen:${externalId}`,
      ...packCandidateText(officialText),
      inlineParser: 'API oficial do DJEN/CNJ',
    }];
  });
}

async function discoverDjen(source, targetDate = null) {
  const publicationDate = targetDate || publicationDateKey(new Date());
  const payload = await discoverDjenCaderno(source.acronym, publicationDate);
  const items = mapDjenDecisions(payload, source, publicationDate);
  if (payload.telemetry) Object.defineProperty(items, 'discoveryTelemetry', { value: payload.telemetry, enumerable: false });
  return items;
}

async function discoverTrf(source, targetDate = null) {
  const [decisions, news] = await Promise.allSettled([
    discoverDjen(source, targetDate),
    discoverLinks(source),
  ]);
  if (decisions.status === 'rejected' && news.status === 'rejected') {
    throw new AggregateError([decisions.reason, news.reason], `As consultas de decisões e notícias do ${source.acronym} falharam.`);
  }
  const items = [
    ...(decisions.status === 'fulfilled' ? decisions.value : []),
    ...(news.status === 'fulfilled' ? news.value : []),
  ];
  if (decisions.status === 'fulfilled' && decisions.value.discoveryTelemetry) {
    Object.defineProperty(items, 'discoveryTelemetry', { value: decisions.value.discoveryTelemetry, enumerable: false });
  }
  return items;
}

async function discoverStf(source, lookbackDays, targetDate = null) {
  const jurisprudence = await discoverStfJurisprudence(targetDate || '', lookbackDays).then((result) => result.items || []);
  const news = await discoverLinks(source).catch(() => []);
  return [...jurisprudence, ...news];
}

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function rssValue(item, tag) {
  return decodeXml(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
}

async function discoverRss(source) {
  const response = await fetch(source.discoveryUrl, { headers: { Accept: 'application/rss+xml, application/xml;q=0.9' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Feed respondeu com status ${response.status}.`);
  const xml = await response.text();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1];
    const title = rssValue(item, 'title');
    const description = rssValue(item, 'description');
    const url = rssValue(item, 'link');
    if (!url.startsWith('https://') || !isTaxRelated(title, description, url)) return [];
    const published = rssValue(item, 'pubDate');
    const publishedAt = Number.isNaN(Date.parse(published)) ? '' : new Date(published).toISOString();
    return [{
      title,
      url: cleanUrl(url),
      publishedAt,
      documentKind: 'Notícia jornalística especializada',
      sourceDocumentType: 'scouting',
      discoveryRole: 'scouting',
      ...packCandidateText(description),
    }];
  }).slice(0, 60);
}

async function discoverLinks(source) {
  const result = await discoverOfficialLinks(source.discoveryUrl || source.url);
  return result.links.filter((item) => isCandidateEligible(source.id, item.title, item.url)).slice(0, 60).map((item) => {
    const normalized = ['receita-cosit', 'receita-in', 'receita-notas'].includes(source.id)
      ? enrichReceitaNormasCandidate(item)
      : { ...item, url: cleanUrl(item.url) };
    const documentKind = normalized.documentKind || (source.id === 'receita-cosit'
      ? 'Solução de Consulta ou Divergência COSIT'
      : source.id === 'receita-in' ? 'Instrução Normativa ou ato RFB'
        : source.id === 'receita-notas' ? 'Nota ou parecer normativo'
          : /^trf[1-6]$/.test(source.id) ? 'Notícia ou decisão oficial de TRF'
          : /\.pdf(?:$|\?)/i.test(normalized.url) ? 'Documento oficial em PDF' : 'Publicação oficial');
    return { ...normalized, documentKind, sections: normalized.sections || source.sections || sectionIdsForSource(source.id) };
  });
}

async function discoverCustomLinks(source) {
  const result = await discoverPublicSourceLinks(source.discoveryUrl || source.url);
  return result.links
    .filter((item) => isCandidateEligible(source.id, item.title, item.url))
    .slice(0, 60)
    .map((item) => ({ ...item, documentKind: 'Publicação de fonte personalizada aprovada' }));
}

async function discoverConfaz(source, targetDate = null) {
  const year = new Date().getFullYear();
  const yearUrl = `${source.url.replace(/\/$/, '')}/${year}/${year}`;
  let result;
  try {
    result = await discoverOfficialLinks(yearUrl);
  } catch (error) {
    if (targetDate) return [];
    throw new Error(`A consulta oficial do CONFAZ falhou sem confirmar ato novo: ${error.message}`);
  }
  return result.links
    .filter((item) => isCandidateEligible(source.id, item.title, item.url))
    .slice(0, 60)
    .map((item) => ({ ...item, url: cleanUrl(item.url), documentKind: 'Ajuste SINIEF ou publicação CONFAZ', sections: source.sections || sectionIdsForSource(source.id) }));
}

export function sourceDateCoverage(source) {
  if (['stj-open-data', 'camara-api', 'receita-normas', 'carf-solr'].includes(source.adapter)) return 'exact';
  if (source.adapter === 'senado-api') return 'date-filtered';
  if (source.adapter === 'stf-jurisprudence' || source.adapter === 'trf-djen') return 'mixed';
  return 'current-index';
}

export async function discoverSourceCandidates(source, lookbackDays = 7, { targetDate = null } = {}) {
  let items;
  if (source.id === 'confaz-ajustes') items = await discoverConfaz(source, targetDate);
  else if (source.adapter === 'camara-api') items = await discoverCamara(source, lookbackDays, targetDate);
  else if (source.adapter === 'senado-api') items = await discoverSenado(source, lookbackDays, targetDate);
  else if (source.adapter === 'stj-open-data') items = await discoverStj(source, lookbackDays, targetDate);
  else if (source.adapter === 'receita-normas') items = await discoverReceitaNormas(source, targetDate);
  else if (source.adapter === 'carf-solr') items = await discoverCarf(source, targetDate);
  else if (source.adapter === 'stf-jurisprudence') items = await discoverStf(source, lookbackDays, targetDate);
  else if (source.adapter === 'trf-djen') items = await discoverTrf(source, targetDate);
  else if (source.adapter === 'rss') items = await discoverRss(source);
  else if (source.adapter === 'custom-links') items = await discoverCustomLinks(source);
  else items = await discoverLinks(source);
  const datedItems = targetDate ? items.filter((item) => publicationDateKey(item.publishedAt) === targetDate) : items;
  const normalizedItems = datedItems.map((item) => ({ ...item, sourceId: source.id, sourceName: source.name, sourceAcronym: source.acronym, sourceType: source.sourceType || 'official', discoveryRole: item.discoveryRole || (source.sourceType === 'journalistic' ? 'scouting' : 'primary'), sections: item.sections || source.sections || sectionIdsForSource(source.id), discoveryMethod: source.adapter, discoveredAt: new Date().toISOString() }));
  if (items.discoveryTelemetry) Object.defineProperty(normalizedItems, 'discoveryTelemetry', { value: items.discoveryTelemetry, enumerable: false });
  return normalizedItems;
}

export const taxTerms = TAX_TERMS;

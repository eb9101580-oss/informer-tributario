import { discoverOfficialLinks, discoverStfJurisprudence } from './collector.js';
import { sectionIdsForSource } from '../data/sections.js';
import { publicationDateKey } from './feedWindow.js';

const TAX_TERMS = [
  'tribut', 'imposto', 'contribuicao previdenciaria', 'contribuicao social', 'contribuicoes sociais', 'credito fiscal', 'credito tributario', 'debito fiscal',
  'icms', 'iss', 'ipi', 'pis', 'cofins', 'irpj', 'csll', 'cbs', 'ibs', 'itcmd', 'itr', 'iof',
  'execucao fiscal', 'divida ativa', 'compensacao tributaria', 'compensacao de tributos', 'parcelamento tributario', 'beneficio fiscal',
  'solucao de consulta', 'solucao de divergencia', 'instrucao normativa', 'nota tecnica', 'nota fiscal eletronica', 'informativo', 'parecer', 'sped',
  'obrigacao acessoria', 'reforma tributaria', 'simples nacional', 'lucro presumido', 'lucro real',
];
const SHORT_TAX_TERMS = new Set(['icms', 'iss', 'ipi', 'pis', 'cofins', 'irpj', 'csll', 'cbs', 'ibs', 'itcmd', 'itr', 'iof']);
const TRF_TAX_PATTERN = /tribut|imposto|icms|\biss\b|\bipi\b|\bpis\b|cofins|irpj|csll|contribui[cç][aã]o social|execu[cç][aã]o fiscal|d[ií]vida ativa|contencioso fiscal|receita federal|fazenda nacional/i;

export function normalizeSearchText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isTaxRelated(...values) {
  const text = normalizeSearchText(values.flat().filter(Boolean).join(' '));
  return TAX_TERMS.some((term) => SHORT_TAX_TERMS.has(term)
    ? new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`, 'i').test(text)
    : text.includes(term));
}

export function hasStrongTaxSignal(...values) {
  const text = normalizeSearchText(values.flat().filter(Boolean).join(' '));
  return TAX_TERMS.filter((term) => term !== 'tribut').some((term) => SHORT_TAX_TERMS.has(term)
    ? new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`, 'i').test(text)
    : text.includes(term)) || /direito tributario|sistema tributario|materia tributaria/.test(text);
}

export function isCandidateEligible(sourceId, title, url) {
  if (/#[^/]*$/.test(url) || /^ir para\b/i.test(title)) return false;
  if (/^trf[1-6]$/.test(sourceId)) {
    const navigationPath = /\/(?:acessibilidade|contato|institucional|magistrado|servicos?|sistemas?)(?:\/|$)/i;
    if (navigationPath.test(new URL(url).pathname)) return false;
    return TRF_TAX_PATTERN.test(`${title} ${url}`);
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
    if (sourceId === 'receita-in') return /instrucao normativa|ato declaratorio/.test(sourceText);
    return /nota|parecer/.test(sourceText);
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

function enrichReceitaNormasCandidate(item) {
  const url = cleanUrl(item.url);
  const match = url.match(/normasinternet2\.receita\.fazenda\.gov\.br\/#\/consulta\/externa\/(\d+)/i);
  if (!match) return { ...item, url };
  return {
    ...item,
    url,
    collectionUrl: `https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/${match[1]}/visao/original`,
    documentKind: 'Ato normativo da Receita Federal',
  };
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
const DJEN_PAGE_SIZE = 100;
let djenRequestQueue = Promise.resolve();
let djenLastRequestAt = 0;
let djenBlockedUntil = 0;

export function isDjenDecision(item = {}) {
  return DJEN_DECISION_PATTERN.test(`${item.tipoDocumento || ''} ${item.tipoComunicacao || ''}`);
}

function djenTaxContext(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const match = text.match(/.{0,90}(?:tribut[aá]ri|execu[cç][aã]o fiscal|cr[eé]dito fiscal|imposto|icms|iss|ipi|pis|cofins|irpj|csll|cbs|ibs).{0,180}/i);
  return (match?.[0] || text.slice(0, 270)).trim();
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
    const kind = item.tipoDocumento || item.tipoComunicacao || 'Decisão';
    const certificateUrl = item.hash ? `${DJEN_API}/${encodeURIComponent(item.hash)}/certidao` : item.link;
    if (!certificateUrl?.startsWith('https://')) return [];
    return [{
      title: `${kind} · ${process} · ${item.nomeOrgao || source.acronym} — Direito tributário: ${djenTaxContext(officialText)}`.slice(0, 500),
      url: certificateUrl,
      publishedAt,
      documentKind: `Decisão judicial publicada no DJEN (${kind})`,
      externalId,
      fingerprintKey: `djen:${externalId}`,
      inlineText: officialText,
      inlineParser: 'API oficial do DJEN/CNJ',
    }];
  });
}

async function fetchDjenPage(source, targetDate, page, pageSize) {
  const params = new URLSearchParams({
    siglaTribunal: source.acronym,
    texto: 'tributario',
    dataDisponibilizacaoInicio: targetDate,
    dataDisponibilizacaoFim: targetDate,
    itensPorPagina: String(pageSize),
    pagina: String(page),
    meio: 'D',
  });
  const url = `${DJEN_API}?${params}`;
  const request = djenRequestQueue.then(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pause = Math.max(0, 3200 - (Date.now() - djenLastRequestAt), djenBlockedUntil - Date.now());
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Informer-Tributario/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      djenLastRequestAt = Date.now();
      const remaining = Number(response.headers.get('x-ratelimit-remaining'));
      if (Number.isFinite(remaining) && remaining <= 0) djenBlockedUntil = Date.now() + 65000;
      if (response.ok) return response.json();
      if ([403, 429].includes(response.status) && attempt === 0) {
        djenBlockedUntil = Date.now() + 65000;
        continue;
      }
      throw new Error(`Fonte respondeu com status ${response.status}.`);
    }
    throw new Error('Limite temporário da API do DJEN excedido.');
  });
  djenRequestQueue = request.catch(() => undefined);
  return request;
}

async function discoverDjen(source, targetDate = null) {
  const publicationDate = targetDate || publicationDateKey(new Date());
  const firstPage = await fetchDjenPage(source, publicationDate, 1, DJEN_PAGE_SIZE);
  const count = Math.max(0, Number(firstPage.count) || 0);
  if (!count) return [];
  const pageCount = Math.ceil(count / DJEN_PAGE_SIZE);
  const remainingPages = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (
    fetchDjenPage(source, publicationDate, index + 2, DJEN_PAGE_SIZE)
  )));
  const items = [firstPage, ...remainingPages].flatMap((payload) => payload.items || []);
  return mapDjenDecisions({ items }, source, publicationDate);
}

async function discoverTrf(source, targetDate = null) {
  const decisions = await discoverDjen(source, targetDate);
  const news = await discoverLinks(source).catch(() => []);
  return [...decisions, ...news];
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
    return [{ title, url: cleanUrl(url), publishedAt, documentKind: 'Notícia jornalística especializada' }];
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

async function discoverConfaz(source, targetDate = null) {
  const year = new Date().getFullYear();
  const yearUrl = `${source.url.replace(/\/$/, '')}/${year}/${year}`;
  let result;
  try {
    result = await discoverOfficialLinks(yearUrl);
  } catch (error) {
    if (targetDate) return [];
    // O índice do CONFAZ pode ficar lento; ainda assim deixamos uma fotografia
    // diária da página oficial na fila, sem transformar a fonte em erro.
    const day = new Date().toISOString().slice(0, 10);
    return [{
      title: `Ajustes SINIEF ${year} — atualização diária`,
      url: `${yearUrl}?informer_snapshot=${day}`,
      collectionUrl: yearUrl,
      publishedAt: day,
      documentKind: 'Índice oficial de Ajustes SINIEF',
      sections: source.sections || sectionIdsForSource(source.id),
      fallbackReason: error.message,
    }];
  }
  return result.links
    .filter((item) => isCandidateEligible(source.id, item.title, item.url))
    .slice(0, 60)
    .map((item) => ({ ...item, url: cleanUrl(item.url), documentKind: 'Ajuste SINIEF ou publicação CONFAZ', sections: source.sections || sectionIdsForSource(source.id) }));
}

export function sourceDateCoverage(source) {
  if (source.adapter === 'stj-open-data' || source.adapter === 'camara-api') return 'exact';
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
  else if (source.adapter === 'stf-jurisprudence') items = await discoverStf(source, lookbackDays, targetDate);
  else if (source.adapter === 'trf-djen') items = await discoverTrf(source, targetDate);
  else if (source.adapter === 'rss') items = await discoverRss(source);
  else items = await discoverLinks(source);
  const datedItems = targetDate ? items.filter((item) => publicationDateKey(item.publishedAt) === targetDate) : items;
  return datedItems.map((item) => ({ ...item, sourceId: source.id, sourceName: source.name, sourceAcronym: source.acronym, sourceType: source.sourceType || 'official', sections: item.sections || source.sections || sectionIdsForSource(source.id), discoveryMethod: source.adapter, discoveredAt: new Date().toISOString() }));
}

export const taxTerms = TAX_TERMS;

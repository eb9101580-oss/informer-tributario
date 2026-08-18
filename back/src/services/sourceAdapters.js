import { discoverOfficialLinks } from './collector.js';

const TAX_TERMS = [
  'tribut', 'imposto', 'contribuicao previdenciaria', 'contribuicao social', 'contribuicoes sociais', 'credito fiscal', 'credito tributario', 'debito fiscal',
  'icms', 'iss', 'ipi', 'pis', 'cofins', 'irpj', 'csll', 'cbs', 'ibs', 'itcmd', 'itr', 'iof',
  'execucao fiscal', 'divida ativa', 'compensacao tributaria', 'compensacao de tributos', 'parcelamento tributario', 'beneficio fiscal',
  'obrigacao acessoria', 'reforma tributaria', 'simples nacional', 'lucro presumido', 'lucro real',
];
const SHORT_TAX_TERMS = new Set(['icms', 'iss', 'ipi', 'pis', 'cofins', 'irpj', 'csll', 'cbs', 'ibs', 'itcmd', 'itr', 'iof']);

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
  if (!isTaxRelated(title, url)) return false;
  if (sourceId === 'receita-federal') return /\/assuntos\/noticias\/20\d{2}\//i.test(url);
  if (sourceId === 'diario-oficial') return /\/web\/dou\/-\//i.test(url);
  return true;
}

function cleanUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = '';
  return url.toString();
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Fonte respondeu com status ${response.status}.`);
  return response.json();
}

async function discoverCamara(_source, lookbackDays) {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const params = new URLSearchParams({ dataInicio: start.toISOString().slice(0, 10), dataFim: end.toISOString().slice(0, 10), ordem: 'DESC', ordenarPor: 'id', itens: '100' });
  const data = await fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?${params}`, { Accept: 'application/json' });
  return (data.dados || []).filter((item) => isTaxRelated(item.ementa, item.siglaTipo)).map((item) => ({
    title: `${item.siglaTipo} ${item.numero}/${item.ano} — ${item.ementa}`,
    url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${item.id}`,
    publishedAt: `${item.ano}-01-01`, documentKind: 'Proposição legislativa', externalId: String(item.id),
  }));
}

function senateItems(data) {
  const items = data?.ListaMateriasAtualizadas?.Materias?.Materia || [];
  return Array.isArray(items) ? items : [items];
}

async function discoverSenado(_source, lookbackDays) {
  const data = await fetchJson(`https://legis.senado.leg.br/dadosabertos/materia/atualizadas?numdias=${lookbackDays}`, { Accept: 'application/json' });
  return senateItems(data).flatMap((item) => {
    const identification = item?.IdentificacaoMateria || {};
    const basics = item?.DadosBasicosMateria || {};
    const code = identification.CodigoMateria;
    const label = [identification.SiglaSubtipoMateria, identification.NumeroMateria, identification.AnoMateria].filter(Boolean).join(' ');
    const summary = basics.EmentaMateria || basics.ExplicacaoEmentaMateria || '';
    if (!code || !isTaxRelated(summary, label)) return [];
    return [{ title: `${label} — ${summary}`, url: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${code}`, publishedAt: basics.DataApresentacao || '', documentKind: 'Matéria legislativa', externalId: String(code) }];
  }).slice(0, 80);
}

function stjPublicationDate(value = '') {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

async function discoverStj() {
  const datasets = ['espelhos-de-acordaos-primeira-secao', 'espelhos-de-acordaos-primeira-turma', 'espelhos-de-acordaos-segunda-turma'];
  const collections = await Promise.all(datasets.map(async (dataset) => {
    const packageData = await fetchJson(`https://dadosabertos.web.stj.jus.br/api/3/action/package_show?id=${dataset}`);
    const resource = (packageData.result?.resources || [])
      .filter((item) => item.format?.toUpperCase() === 'JSON' && /\.json(?:$|\?)/i.test(item.url))
      .sort((left, right) => String(right.name || right.last_modified).localeCompare(String(left.name || left.last_modified)))[0];
    if (!resource) return [];
    return fetchJson(resource.url);
  }));
  return collections.flat().filter((item) => isTaxRelated(item.ementa, item.teseJuridica, item.referenciasLegislativas)).slice(0, 50).map((item) => {
    const publishedAt = stjPublicationDate(item.dataPublicacao);
    const processLabel = `${item.siglaClasse || 'Processo'} ${item.numeroProcesso || item.numeroRegistro}`;
    const summary = String(item.ementa || '').replace(/\s+/g, ' ').trim();
    const params = new URLSearchParams({ num_registro: item.numeroRegistro });
    if (publishedAt) params.set('dt_publicacao', publishedAt.split('-').reverse().join('/'));
    return { title: `${processLabel} — ${summary.slice(0, 260)}`, url: `https://processo.stj.jus.br/SCON/GetInteiroTeorDoAcordao?${params}`, publishedAt, documentKind: 'Inteiro teor de acórdão', externalId: String(item.id || item.numeroRegistro) };
  });
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
  return result.links.filter((item) => isCandidateEligible(source.id, item.title, item.url)).slice(0, 60).map((item) => ({
    ...item, url: cleanUrl(item.url), documentKind: /\.pdf(?:$|\?)/i.test(item.url) ? 'Documento oficial em PDF' : 'Publicação oficial',
  }));
}

export async function discoverSourceCandidates(source, lookbackDays = 7) {
  let items;
  if (source.adapter === 'camara-api') items = await discoverCamara(source, lookbackDays);
  else if (source.adapter === 'senado-api') items = await discoverSenado(source, lookbackDays);
  else if (source.adapter === 'stj-open-data') items = await discoverStj();
  else if (source.adapter === 'rss') items = await discoverRss(source);
  else items = await discoverLinks(source);
  return items.map((item) => ({ ...item, sourceId: source.id, sourceName: source.name, sourceAcronym: source.acronym, sourceType: source.sourceType || 'official', discoveryMethod: source.adapter, discoveredAt: new Date().toISOString() }));
}

export const taxTerms = TAX_TERMS;

import { discoverOfficialLinks } from './collector.js';
import { sectionIdsForSource } from '../data/sections.js';

const TAX_TERMS = [
  'tribut', 'imposto', 'contribuicao previdenciaria', 'contribuicao social', 'contribuicoes sociais', 'credito fiscal', 'credito tributario', 'debito fiscal',
  'icms', 'iss', 'ipi', 'pis', 'cofins', 'irpj', 'csll', 'cbs', 'ibs', 'itcmd', 'itr', 'iof',
  'execucao fiscal', 'divida ativa', 'compensacao tributaria', 'compensacao de tributos', 'parcelamento tributario', 'beneficio fiscal',
  'solucao de consulta', 'solucao de divergencia', 'instrucao normativa', 'nota tecnica', 'nota fiscal eletronica', 'informativo', 'parecer', 'sped',
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
  if (/#[^/]*$/.test(url) || /^ir para\b/i.test(title)) return false;
  if (sourceId === 'confaz-ajustes') return /\/ajustes\/\d{4}\/[^/]+/i.test(url) && /ajuste|sinief|ato cotepe|conv[eê]nio|documento fiscal|leiaute/i.test(title);
  if (sourceId === 'diario-oficial') return /portaria|lei|decreto|instru[cç][aã]o normativa|ato declarat[oó]rio|despacho|conv[eê]nio|tribut|imposto|contribui/i.test(`${title} ${url}`);
  if (['reforma-cgibs', 'reforma-portal', 'reforma-folha', 'reforma-valor'].includes(sourceId)) {
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
  return result.links.filter((item) => isCandidateEligible(source.id, item.title, item.url)).slice(0, 60).map((item) => {
    const normalized = ['receita-cosit', 'receita-in', 'receita-notas'].includes(source.id)
      ? enrichReceitaNormasCandidate(item)
      : { ...item, url: cleanUrl(item.url) };
    const documentKind = normalized.documentKind || (source.id === 'receita-cosit'
      ? 'Solução de Consulta ou Divergência COSIT'
      : source.id === 'receita-in' ? 'Instrução Normativa ou ato RFB'
        : source.id === 'receita-notas' ? 'Nota ou parecer normativo'
          : /\.pdf(?:$|\?)/i.test(normalized.url) ? 'Documento oficial em PDF' : 'Publicação oficial');
    return { ...normalized, documentKind, sections: normalized.sections || source.sections || sectionIdsForSource(source.id) };
  });
}

async function discoverConfaz(source) {
  const year = new Date().getFullYear();
  const yearUrl = `${source.url.replace(/\/$/, '')}/${year}/${year}`;
  const result = await discoverOfficialLinks(yearUrl);
  return result.links
    .filter((item) => isCandidateEligible(source.id, item.title, item.url))
    .slice(0, 60)
    .map((item) => ({ ...item, url: cleanUrl(item.url), documentKind: 'Ajuste SINIEF ou publicação CONFAZ', sections: source.sections || sectionIdsForSource(source.id) }));
}

export async function discoverSourceCandidates(source, lookbackDays = 7) {
  let items;
  if (source.id === 'confaz-ajustes') items = await discoverConfaz(source);
  else if (source.adapter === 'camara-api') items = await discoverCamara(source, lookbackDays);
  else if (source.adapter === 'senado-api') items = await discoverSenado(source, lookbackDays);
  else if (source.adapter === 'stj-open-data') items = await discoverStj();
  else if (source.adapter === 'rss') items = await discoverRss(source);
  else items = await discoverLinks(source);
  return items.map((item) => ({ ...item, sourceId: source.id, sourceName: source.name, sourceAcronym: source.acronym, sourceType: source.sourceType || 'official', sections: item.sections || source.sections || sectionIdsForSource(source.id), discoveryMethod: source.adapter, discoveredAt: new Date().toISOString() }));
}

export const taxTerms = TAX_TERMS;

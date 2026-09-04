import { publicCourtUrl, normalizeProcessNumber, inferCourtFromProcessNumber } from './datajud.js';
import { packCandidateText } from './candidateText.js';
import { createHash } from 'node:crypto';

// Padrões de identificação de processos nos tribunais superiores e regionais
export const PROCESS_PATTERNS = [
  // CNJ unificado: NNNNNNN-DD.AAAA.J.TR.OOOO
  /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/,
  // STJ: REsp, AREsp, RMS, CC, HC, etc. com número e UF opcional (inclui \/ escapado de JSON)
  /\b(resp|aresp|rms)\s*(?:n[ºo.]?\s*)?([\d.]{4,})(?:[\s/\\|]+([a-z]{2}))?\b/gi,
  // STF: RE, ARE, ADI, ADC, ADPF, ACO, MS com número e UF opcional (inclui \/ escapado de JSON)
  /\b(re|are|adi|adc|adpf|aco|ms)\s*(?:n[ºo.]?\s*)?([\d.]{4,})(?:[\s/\\|]+([a-z]{2}))?\b/gi,
  // Temas repetitivos / repercussão geral
  /\btema\s*(?:n[ºo.]?\s*)?(\d{1,5})\s*(?:do\s+)?(stf|stj|tnu)\b/gi,
];

export function extractLegalCases(text = '') {
  const normalized = String(text || '').replace(/\\\/|\//g, '/').replace(/\s+/g, ' ');
  const cases = [];

  // 1. Número CNJ
  const cnjMatches = normalized.matchAll(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/g);
  for (const match of cnjMatches) {
    const cnj = match[1];
    const court = inferCourtFromProcessNumber(cnj) || 'cnj';
    cases.push({
      type: 'cnj',
      raw: cnj,
      number: cnj.replace(/\D/g, ''),
      formatted: cnj,
      court,
      label: `Processo nº ${cnj}`,
    });
  }

  // 2. REsp / AREsp / RMS (STJ)
  const KIND_LABELS = {
    resp: 'REsp',
    aresp: 'AREsp',
    rms: 'RMS',
    re: 'RE',
    are: 'ARE',
    adi: 'ADI',
    adc: 'ADC',
    adpf: 'ADPF',
    aco: 'ACO',
    ms: 'MS',
  };

  const stjMatches = normalized.matchAll(/\b(resp|aresp|rms)\s*(?:n[ºo.]?\s*)?([\d.]{4,})(?:[\s/\\|]+([a-z]{2}))?\b/gi);
  for (const match of stjMatches) {
    const rawKind = match[1].toLowerCase();
    const kind = KIND_LABELS[rawKind] || rawKind.toUpperCase();
    const number = match[2].replace(/\D/g, '');
    const uf = (match[3] || '').toUpperCase();
    const formatted = uf ? `${kind} ${number}/${uf}` : `${kind} ${number}`;
    if (!cases.some((c) => c.number === number)) {
      cases.push({
        type: rawKind,
        raw: match[0],
        number,
        uf: uf || null,
        formatted,
        court: 'stj',
        label: formatted,
      });
    }
  }

  // 3. RE / ARE / ADI / ADC / ADPF / ACO (STF)
  const stfMatches = normalized.matchAll(/\b(re|are|adi|adc|adpf|aco)\s*(?:n[ºo.]?\s*)?([\d.]{4,})(?:[\s/\\|]+([a-z]{2}))?\b/gi);
  for (const match of stfMatches) {
    const rawKind = match[1].toLowerCase();
    const kind = KIND_LABELS[rawKind] || rawKind.toUpperCase();
    const number = match[2].replace(/\D/g, '');
    const uf = (match[3] || '').toUpperCase();
    const formatted = uf ? `${kind} ${number}/${uf}` : `${kind} ${number}`;
    if (!cases.some((c) => c.number === number)) {
      cases.push({
        type: kind.toLowerCase(),
        raw: match[0],
        number,
        uf: uf || null,
        formatted,
        court: 'stf',
        label: formatted,
      });
    }
  }

  return cases;
}

export function generateOfficialProcessUrl(legalCase) {
  if (!legalCase) return null;
  const { court, number, formatted } = legalCase;

  if (court === 'stj') {
    const params = new URLSearchParams({
      termo: number,
      aplicacao: 'processos.ea',
      tipoPesquisa: 'tipoPesquisaGenerica',
      chordem: 'DESC',
      chkMorto: 'MORTO',
    });
    return `https://processo.stj.jus.br/processo/pesquisa/?${params.toString()}`;
  }

  if (court === 'stf') {
    return `https://portal.stf.jus.br/processos/detalhe.asp?processo=${number}`;
  }

  return publicCourtUrl(court, number || formatted);
}

export function resolveScoutingToPrimary(candidate = {}, fullText = '') {
  const combinedText = `${candidate.title || ''} ${candidate.content || ''} ${fullText || ''}`;
  const cases = extractLegalCases(combinedText);

  if (!cases.length) {
    return null;
  }

  const primaryCase = cases[0];
  const officialUrl = generateOfficialProcessUrl(primaryCase);
  const courtName = primaryCase.court.toUpperCase();
  const enrichedTitle = candidate.title?.includes(primaryCase.formatted)
    ? candidate.title
    : `${candidate.title || 'Decisão judicial'} (${primaryCase.formatted})`;

  const promotedId = createHash('sha256')
    .update(`promoted:${primaryCase.formatted}:${candidate.url}`)
    .digest('hex')
    .slice(0, 24);

  const enrichedContent = [
    `Processo Judicial: ${primaryCase.formatted}`,
    `Tribunal: ${courtName}`,
    `Link Oficial: ${officialUrl}`,
    `Origem do Radar: ${candidate.sourceAcronym || candidate.sourceName || 'Radar jornalístico'}`,
    '',
    fullText || candidate.content || candidate.text || '',
  ].join('\n');

  return {
    ...candidate,
    id: promotedId,
    title: enrichedTitle,
    url: officialUrl,
    officialUrl,
    discoveryUrl: candidate.url,
    scoutingOriginalUrl: candidate.url,
    originalSourceId: candidate.sourceId,
    originalSourceName: candidate.sourceName,
    sourceId: primaryCase.court,
    sourceName: courtName === 'STJ' ? 'Superior Tribunal de Justiça' : courtName === 'STF' ? 'Supremo Tribunal Federal' : `Tribunal ${courtName}`,
    sourceAcronym: courtName,
    sourceType: 'official',
    discoveryRole: 'primary',
    documentKind: `Julgamento em sessão / Notícia oficial de processo (${primaryCase.formatted})`,
    sourceDocumentType: 'Julgamento em sessão',
    legalCase: primaryCase,
    allLegalCases: cases,
    promotedFromScouting: true,
    publishedAt: candidate.publishedAt || new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    status: 'pending',
    discardReason: null,
    fastTriage: null,
    content: enrichedContent,
    inlineParser: `Resolução de inteligência jurídica (${primaryCase.formatted})`,
    ...packCandidateText(enrichedContent),
  };
}

export const extractProcessReferences = extractLegalCases;
export const officialCourtUrl = generateOfficialProcessUrl;

export function extractTextFromArticleHtml(html = '') {
  let richText = '';

  // 1. Next.js data (__NEXT_DATA__)
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const post = data.props?.pageProps?.post || data.props?.pageProps?.article || data.props?.pageProps?.news;
      if (post) {
        richText += ` ${post.title || ''} ${post.subtitle || ''} ${post.excerpt || ''} ${post.content || ''}`;
      } else {
        const pagePropsStr = JSON.stringify(data.props?.pageProps || {});
        richText += ` ${pagePropsStr.replace(/\\"/g, '"').replace(/\\\//g, '/')}`;
      }
    } catch {}
  }

  // 2. JSON-LD (Schema.org NewsArticle, Article)
  const ldMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        richText += ` ${item.headline || ''} ${item.description || ''} ${item.articleBody || ''}`;
      }
    } catch {}
  }

  // 3. Meta tags (OpenGraph, Twitter, Description)
  const metaMatches = html.matchAll(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description|description)["']\s+content=["']([^"']+)["']/gi);
  for (const m of metaMatches) {
    richText += ` ${m[1]}`;
  }

  // 4. HTML limpo de scripts normais e estilos
  const cleanBody = html
    .replace(/<script(?![^>]*id="__NEXT_DATA__")[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  return `${richText} ${cleanBody}`.trim();
}

export async function resolveScoutingCandidate(candidate = {}, fetchArticle = false) {
  let combinedText = `${candidate.title || ''} ${candidate.content || ''}`;
  let cases = extractLegalCases(combinedText);

  if (!cases.length && fetchArticle && candidate.url) {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const html = await response.text();
        const extractedText = extractTextFromArticleHtml(html);
        cases = extractLegalCases(extractedText);
        if (cases.length) {
          combinedText = `${candidate.title || ''} ${extractedText.slice(0, 15000)}`;
        }
      }
    } catch {
      // Ignora erro de requisição em rede e continua
    }
  }

  if (!cases.length) return null;
  return resolveScoutingToPrimary(candidate, combinedText);
}

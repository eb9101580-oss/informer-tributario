import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata.azure.internal']);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function privateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 255);
}

function privateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

export function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) return privateIpv4(address);
  if (version === 6) return privateIpv6(address);
  return true;
}

export function normalizeCustomSourceUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); }
  catch {
    const error = new Error('Informe um endereço HTTPS válido.');
    error.statusCode = 400;
    throw error;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    const error = new Error('A fonte deve usar HTTPS, sem credenciais ou porta personalizada.');
    error.statusCode = 400;
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    const error = new Error('Este domínio não pode ser usado como fonte.');
    error.statusCode = 400;
    throw error;
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    const error = new Error('Endereços de rede privada não podem ser monitorados.');
    error.statusCode = 400;
    throw error;
  }
  parsed.hash = '';
  return parsed.toString();
}

export function inferSourceType(rawUrl) {
  try {
    const hostname = new URL(String(rawUrl || '')).hostname.toLowerCase().replace(/\.$/, '');
    return /(?:^|\.)(?:gov|jus|leg)\.br$/.test(hostname) ? 'official' : 'journalistic';
  } catch {
    return 'journalistic';
  }
}

export async function assertPublicSourceUrl(rawUrl, { resolver = lookup } = {}) {
  const url = normalizeCustomSourceUrl(rawUrl);
  const hostname = new URL(url).hostname;
  let addresses;
  try { addresses = await resolver(hostname, { all: true, verbatim: true }); }
  catch {
    const error = new Error('Não foi possível resolver o domínio informado.');
    error.statusCode = 422;
    throw error;
  }
  if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    const error = new Error('O domínio aponta para uma rede privada ou reservada.');
    error.statusCode = 400;
    throw error;
  }
  return url;
}

export async function fetchPublicSource(rawUrl, { fetchImpl = fetch, maxRedirects = 5, resolver = lookup } = {}) {
  let current = await assertPublicSourceUrl(rawUrl, { resolver });
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml;q=0.9', 'User-Agent': 'Informer-Tributario/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === maxRedirects) throw Object.assign(new Error('A fonte excedeu o limite de redirecionamentos.'), { statusCode: 422 });
      current = await assertPublicSourceUrl(new URL(location, current).toString(), { resolver });
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`A fonte respondeu com status ${response.status}.`), { statusCode: 422 });
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_BYTES) throw Object.assign(new Error('A página da fonte excede 2 MB.'), { statusCode: 413 });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_SOURCE_BYTES) throw Object.assign(new Error('A página da fonte excede 2 MB.'), { statusCode: 413 });
    return { url: current, contentType: response.headers.get('content-type') || '', text: body.toString('utf8') };
  }
  throw Object.assign(new Error('Não foi possível abrir a fonte.'), { statusCode: 422 });
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateFromText(value = '') {
  const iso = String(value).match(/\b(20\d{2}-\d{2}-\d{2})(?:T[\d:.+-Z]+)?\b/)?.[1];
  if (iso && !Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return iso;
  const brazilian = String(value).match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!brazilian) return null;
  const normalized = `${brazilian[3]}-${brazilian[2].padStart(2, '0')}-${brazilian[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${normalized}T12:00:00Z`)) ? null : normalized;
}

export async function discoverPublicSourceLinks(rawUrl, options = {}) {
  const page = await fetchPublicSource(rawUrl, options);
  const rootHost = new URL(page.url).hostname;
  const found = [];
  const seen = new Set();
  const append = (href, title, context = '') => {
    if (!href || !title || found.length >= 120) return;
    let absolute;
    try { absolute = new URL(decodeHtml(href), page.url); } catch { return; }
    if (absolute.protocol !== 'https:' || !(absolute.hostname === rootHost || absolute.hostname.endsWith(`.${rootHost}`))) return;
    absolute.hash = '';
    const url = absolute.toString();
    if (seen.has(url)) return;
    const normalizedTitle = decodeHtml(title).slice(0, 300);
    if (normalizedTitle.length < 5) return;
    seen.add(url);
    found.push({ title: normalizedTitle, url, publishedAt: dateFromText(`${context} ${title}`) });
  };

  for (const match of page.text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const start = Math.max(0, (match.index || 0) - 500);
    const end = Math.min(page.text.length, (match.index || 0) + match[0].length + 500);
    append(match[1], match[2], page.text.slice(start, end));
  }
  for (const match of page.text.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)) {
    const block = match[1];
    const title = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const link = block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]
      || block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    append(link, title, block);
  }
  return { ...page, links: found };
}

export async function collectPublicSourceDocument(rawUrl, options = {}) {
  const page = await fetchPublicSource(rawUrl, options);
  const title = decodeHtml(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(page.url).pathname.split('/').filter(Boolean).pop() || 'Publicação');
  const withoutNoise = page.text.replace(/<(script|style|noscript|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const text = decodeHtml(withoutNoise).slice(0, 60000);
  return { url: page.url, title, text, characters: text.length, contentType: page.contentType, publishedAt: dateFromText(page.text), parser: 'Coletor HTTPS seguro' };
}

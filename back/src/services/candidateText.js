import { gzipSync, gunzipSync } from 'node:zlib';

const INLINE_LIMIT = 2000;

export function packCandidateText(value = '') {
  const text = String(value);
  if (text.length <= INLINE_LIMIT) return { inlineText: text };
  return { inlineTextGzip: gzipSync(text, { level: 9 }).toString('base64') };
}

export function unpackCandidateText(candidate = {}) {
  if (candidate.inlineText) return candidate.inlineText;
  if (!candidate.inlineTextGzip) return '';
  return gunzipSync(Buffer.from(candidate.inlineTextGzip, 'base64')).toString('utf8');
}

export function hasCandidateText(candidate = {}) {
  return Boolean(candidate.inlineText || candidate.inlineTextGzip);
}

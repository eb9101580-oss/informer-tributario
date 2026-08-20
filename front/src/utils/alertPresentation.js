const SENTENCE_TYPE_PATTERN = /^\s*(senten[cç]a)\s+tipo\s+([a-z0-9]+)\s*(?:[·—-]\s*)?/i;

export function displayAlertTitle(value = '') {
  return String(value).replace(SENTENCE_TYPE_PATTERN, '$1 · ').trim();
}

export function displayDocumentKind(value = '') {
  return String(value)
    .replace(/^decis[aã]o judicial publicada no DJEN\s*\(senten[cç]a\s+tipo\s+[a-z0-9]+\)$/i, 'Sentença judicial publicada no DJEN')
    .trim();
}

export function sourceDocumentClassification(alert = {}) {
  const explicit = String(alert.provenance?.sourceDocumentType || '').trim();
  if (explicit) return explicit;
  const match = String(alert.title || '').match(SENTENCE_TYPE_PATTERN);
  return match ? `Sentença Tipo ${match[2].toUpperCase()}` : '';
}

export function sentenceTypeExplanation(value = '') {
  const match = String(value).match(/senten[cç]a\s+tipo\s+([a-z0-9]+)/i);
  const type = match?.[1]?.toUpperCase();
  if (type === 'A') return 'mérito com fundamentação individualizada';
  if (type === 'B') return 'mérito, repetitiva ou homologatória';
  if (type === 'C') return 'sem resolução do mérito';
  return '';
}

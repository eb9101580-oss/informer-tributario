import { Router } from 'express';

const DJEN_CADERNO_API = 'https://comunicaapi.pje.jus.br/api/v1/caderno';
// O endereço do ZIP é assinado por somente cinco minutos. O cache precisa
// deixar tempo suficiente para o runner baixar até os maiores cadernos.
const MEMORY_CACHE_TTL_MS = 90_000;
const RESPONSE_CACHE_CONTROL = 'public, max-age=0, s-maxage=120, stale-while-revalidate=15';
const MAX_MEMORY_CACHE_ENTRIES = 128;
const metadataCache = new Map();

export const djenRouter = Router();

export function normalizeDjenMetadataParams(rawTribunal, rawDate) {
  const tribunal = String(rawTribunal || '').trim().toUpperCase();
  const date = String(rawDate || '').trim();
  if (!/^TRF[1-6]$/.test(tribunal)) {
    const error = new Error('Tribunal inválido. Informe TRF1, TRF2, TRF3, TRF4, TRF5 ou TRF6.');
    error.statusCode = 400;
    throw error;
  }

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!parsed
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) {
    const error = new Error('Data inválida. Use o formato AAAA-MM-DD.');
    error.statusCode = 400;
    throw error;
  }

  return { tribunal, date };
}

async function fetchDjenMetadata(tribunal, date) {
  const upstream = await fetch(`${DJEN_CADERNO_API}/${tribunal}/${date}/D`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Informer-Tributario/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) {
    const error = new Error(upstream.status === 404
      ? 'O DJEN ainda não disponibilizou o caderno solicitado.'
      : `O DJEN respondeu com status ${upstream.status}.`);
    error.statusCode = upstream.status === 404 ? 404 : 502;
    throw error;
  }

  const payload = await upstream.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('O DJEN devolveu metadados em formato inválido.');
    error.statusCode = 502;
    throw error;
  }
  return payload;
}

export function clearDjenMetadataCache() {
  metadataCache.clear();
}

djenRouter.get('/caderno-metadata/:tribunal/:date', async (request, response, next) => {
  try {
    const { tribunal, date } = normalizeDjenMetadataParams(request.params.tribunal, request.params.date);
    const cacheKey = `${tribunal}:${date}`;
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      response.set('Cache-Control', RESPONSE_CACHE_CONTROL);
      response.set('X-Informer-Cache', 'HIT');
      return response.json(cached.payload);
    }

    const payload = await fetchDjenMetadata(tribunal, date);
    if (metadataCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      metadataCache.delete(metadataCache.keys().next().value);
    }
    metadataCache.set(cacheKey, { payload, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS });
    response.set('Cache-Control', RESPONSE_CACHE_CONTROL);
    response.set('X-Informer-Cache', 'MISS');
    return response.json(payload);
  } catch (error) {
    return next(error);
  }
});

import { config } from '../config.js';

const COURT_LABELS = {
  stj: 'STJ',
  stf: 'STF',
  trf1: 'TRF1', trf2: 'TRF2', trf3: 'TRF3', trf4: 'TRF4', trf5: 'TRF5', trf6: 'TRF6',
  tjsp: 'TJSP', tjrj: 'TJRJ', tjmg: 'TJMG', tjrs: 'TJRS', tjpr: 'TJPR', tjba: 'TJBA',
};

const SEARCH_FIELDS = [
  'assuntos.nome^5',
  'assuntos.descricao^4',
  'classe.nome^2',
  'movimentos.nome^3',
  'movimentos.complementosTabelados.nome^2',
  'movimentos.complementosTabelados.descricao',
  'orgaoJulgador.nomeOrgao',
  'tribunal',
  'numeroProcesso',
];

export const DATAJUD_COURTS = Object.entries(COURT_LABELS).map(([value, label]) => ({ value, label }));

function fail(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function normalizeCourt(value) {
  const court = String(value || '').trim().toLowerCase();
  if (!COURT_LABELS[court]) throw fail('Informe um tribunal DataJud válido.', 400);
  return court;
}

export function normalizeProcessNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 20 ? digits : '';
}

function queryForTracker(tracker) {
  const processNumber = normalizeProcessNumber(tracker.query);
  if (processNumber) return { term: { numeroProcesso: processNumber } };
  return {
    multi_match: {
      query: tracker.query,
      fields: SEARCH_FIELDS,
      type: 'best_fields',
      operator: 'and',
    },
  };
}

function formatProcessNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 20) return value || 'Processo sem número informado';
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

function movementDate(movement) {
  const date = movement?.dataHora || movement?.data || movement?.dataMovimento || movement?.date;
  const timestamp = date ? new Date(date).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeMovement(movement = {}) {
  const complements = Array.isArray(movement.complementosTabelados) ? movement.complementosTabelados : [];
  const complementText = complements.map((item) => item?.descricao || item?.nome).filter(Boolean).join(' · ');
  const name = movement.nome || movement.descricao || 'Movimentação sem descrição';
  return {
    id: `${movement.dataHora || movement.data || ''}-${movement.codigo || ''}-${name}`,
    date: movement.dataHora || movement.data || movement.dataMovimento || null,
    name,
    code: movement.codigo ?? null,
    complement: complementText || null,
    court: movement.orgaoJulgador?.nomeOrgao || movement.orgaoJulgador?.nome || null,
  };
}

function normalizeHit(hit, fallbackCourt) {
  const source = hit?._source || {};
  const movements = (Array.isArray(source.movimentos) ? source.movimentos : [])
    .map(normalizeMovement)
    .sort((left, right) => movementDate(right) - movementDate(left))
    .filter((movement, index, list) => index === list.findIndex((item) => item.id === movement.id))
    .slice(0, 30);
  const latest = movements[0] || null;
  return {
    id: source.id || hit?._id || `${fallbackCourt}-${source.numeroProcesso || hit?._id || Math.random()}`,
    processNumber: source.numeroProcesso || null,
    processNumberFormatted: formatProcessNumber(source.numeroProcesso),
    tribunal: source.tribunal || fallbackCourt.toUpperCase(),
    grau: source.grau || null,
    dataAjuizamento: source.dataAjuizamento || null,
    latestMovement: latest,
    movements,
  };
}

export function summarizeDataJudResponse(body, court) {
  const hits = Array.isArray(body?.hits?.hits) ? body.hits.hits : [];
  const processes = hits.map((hit) => normalizeHit(hit, court));
  const movements = processes.flatMap((process) => process.movements.map((movement) => ({ ...movement, processNumber: process.processNumberFormatted, processId: process.id })));
  movements.sort((left, right) => movementDate(right) - movementDate(left));
  const latest = movements[0] || null;
  return {
    resultCount: Number(body?.hits?.total?.value ?? body?.hits?.total ?? processes.length) || processes.length,
    processCount: processes.length,
    processes,
    movements: movements.slice(0, 40),
    latestMovement: latest,
    status: latest?.name || (processes.length ? 'Processo localizado; sem movimentações no retorno' : 'Nenhum processo localizado'),
  };
}

export async function queryDataJud(tracker) {
  if (!config.datajudApiKey) throw fail('DATAJUD_API_KEY não está configurada no backend.', 503);
  const court = normalizeCourt(tracker.court);
  const query = String(tracker.query || '').trim();
  if (query.length < 2) throw fail('Informe um tema ou número de processo para acompanhar.', 400);
  const url = `${config.datajudBaseUrl.replace(/\/$/, '')}/api_publica_${court}/_search`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `APIKey ${config.datajudApiKey}`,
      },
      body: JSON.stringify({
        size: 20,
        track_total_hits: true,
        sort: [{ dataHoraUltimaAtualizacao: { order: 'desc', unmapped_type: 'date' } }, { _score: 'desc' }],
        query: queryForTracker({ ...tracker, query }),
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.error?.reason || body?.message || `status ${response.status}`;
      throw fail(`DataJud recusou a consulta (${detail}).`, response.status === 401 || response.status === 403 ? 502 : response.status);
    }
    return summarizeDataJudResponse(body, court);
  } catch (error) {
    if (error.name === 'AbortError') throw fail('A consulta ao DataJud excedeu 25 segundos.', 504);
    if (error.statusCode) throw error;
    throw fail(`Não foi possível consultar o DataJud: ${error.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function courtLabel(court) {
  return COURT_LABELS[String(court || '').toLowerCase()] || String(court || '').toUpperCase();
}

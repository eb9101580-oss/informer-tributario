import { config } from '../config.js';

const COURT_LABELS = {
  stf: 'STF (portal oficial)',
  stj: 'STJ',
  trf1: 'TRF1', trf2: 'TRF2', trf3: 'TRF3', trf4: 'TRF4', trf5: 'TRF5', trf6: 'TRF6',
  tjac: 'TJAC', tjal: 'TJAL', tjam: 'TJAM', tjap: 'TJAP', tjba: 'TJBA', tjce: 'TJCE',
  tjdft: 'TJDFT', tjes: 'TJES', tjgo: 'TJGO', tjma: 'TJMA', tjmg: 'TJMG', tjms: 'TJMS',
  tjmt: 'TJMT', tjpa: 'TJPA', tjpb: 'TJPB', tjpe: 'TJPE', tjpi: 'TJPI', tjpr: 'TJPR',
  tjrj: 'TJRJ', tjrn: 'TJRN', tjro: 'TJRO', tjrr: 'TJRR', tjrs: 'TJRS', tjsc: 'TJSC',
  tjse: 'TJSE', tjsp: 'TJSP', tjto: 'TJTO',
};

const STATE_COURTS = {
  '01': 'tjac', '02': 'tjal', '03': 'tjap', '04': 'tjam', '05': 'tjba', '06': 'tjce',
  '07': 'tjdft', '08': 'tjes', '09': 'tjgo', '10': 'tjma', '11': 'tjmt', '12': 'tjms',
  '13': 'tjmg', '14': 'tjpa', '15': 'tjpb', '16': 'tjpr', '17': 'tjpe', '18': 'tjpi',
  '19': 'tjrj', '20': 'tjrn', '21': 'tjrs', '22': 'tjro', '23': 'tjrr', '24': 'tjsc',
  '25': 'tjse', '26': 'tjsp', '27': 'tjto',
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
  if (!COURT_LABELS[court]) throw fail('Informe um tribunal oficial válido.', 400);
  return court;
}

export function normalizeProcessNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 20 ? digits : '';
}

export function inferCourtFromProcessNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 20) return null;
  const segment = digits[13];
  const tribunal = digits.slice(14, 16);
  if (segment === '1') return 'stf';
  if (segment === '3') return 'stj';
  if (segment === '4' && /^[0-6]$/.test(tribunal)) return `trf${Number(tribunal)}`;
  if (segment === '8') return STATE_COURTS[tribunal] || null;
  return null;
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

const STF_PROCESS_URL = 'https://portal.stf.jus.br/processos/detalhe.asp';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseBrazilDate(value) {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))).toISOString();
}

function extractStfIncident(value) {
  const text = String(value || '').trim();
  const fromUrl = text.match(/[?&]incidente=(\d+)/i);
  if (fromUrl) return fromUrl[1];
  const onlyNumber = text.match(/^\d{5,}$/);
  return onlyNumber ? onlyNumber[0] : null;
}

function parseStfMovements(html, prefix = 'andamento') {
  const blocks = String(html || '').split(/(?=<div class="andamento-item\b)/i).slice(1);
  return blocks.map((block) => {
    const dateMatch = block.match(/class="andamento-data[^>]*">\s*([^<]+?)\s*<\/div>/i);
    const nameMatch = block.match(/class="andamento-nome[^>]*">\s*([\s\S]*?)\s*<\/h5>/i);
    if (!dateMatch || !nameMatch) return null;
    const date = parseBrazilDate(stripHtml(dateMatch[1]));
    const name = stripHtml(nameMatch[1]);
    const judgeMatch = block.match(/class="andamento-julgador[^>]*">\s*([\s\S]*?)\s*<\/span>/i);
    return {
      id: `${prefix}-${date || dateMatch[1]}-${name}`,
      date,
      name,
      code: null,
      complement: judgeMatch ? stripHtml(judgeMatch[1]) : null,
      court: 'STF',
    };
  }).filter(Boolean);
}

async function queryStf(tracker) {
  const incident = extractStfIncident(tracker.query);
  if (!incident) throw fail('Para acompanhar o STF, cole o link oficial do processo com “incidente=...” ou informe o número do incidente.', 400);
  const detailUrl = `${STF_PROCESS_URL}?incidente=${incident}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const urls = [
      detailUrl,
      `https://portal.stf.jus.br/processos/abaAndamentos.asp?incidente=${incident}&imprimir=`,
      `https://portal.stf.jus.br/processos/abaDecisoes.asp?incidente=${incident}`,
      `https://portal.stf.jus.br/processos/abaInformacoes.asp?incidente=${incident}`,
    ];
    const responses = await Promise.all(urls.map((url) => fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      },
      signal: controller.signal,
    })));
    const bodies = await Promise.all(responses.map(async (response) => {
      if (!response.ok) throw fail(`O portal do STF recusou a consulta (status ${response.status}).`, 502);
      return response.text();
    }));
    const [detail, movementsHtml, decisionsHtml, infoHtml] = bodies;
    const title = detail.match(/id="classe-numero-processo"[^>]*value="([^"]+)"/i)?.[1] || stripHtml(detail.match(/class="processo-titulo[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const uniqueNumber = stripHtml(detail.match(/N[úu]mero\s+Ú?nico:\s*([^<]+)/i)?.[1]) || stripHtml(infoHtml.match(/N[úu]mero\s+de\s+Origem:\s*([^<]+)/i)?.[1]);
    const theme = detail.match(/Rep\.\s*Geral\s*Tema:\s*(\d+)/i)?.[1] || null;
    const movements = [...parseStfMovements(decisionsHtml, 'stf-decision'), ...parseStfMovements(movementsHtml, 'stf-movement')]
      .sort((left, right) => movementDate(right) - movementDate(left))
      .filter((movement, index, list) => index === list.findIndex((item) => item.id === movement.id))
      .slice(0, 40);
    const latest = movements[0] || null;
    const process = {
      id: `stf-${incident}`,
      processNumber: uniqueNumber || title || `Incidente ${incident}`,
      processNumberFormatted: uniqueNumber || title || `Incidente ${incident}`,
      tribunal: 'STF',
      grau: null,
      dataAjuizamento: null,
      latestMovement: latest,
      movements,
      theme,
      incident,
    };
    return {
      court: 'stf',
      sourceUrl: detailUrl,
      incident,
      theme,
      resultCount: 1,
      processCount: 1,
      processes: [process],
      movements: movements.map((movement) => ({ ...movement, processNumber: process.processNumberFormatted, processId: process.id })),
      latestMovement: latest ? { ...latest, processNumber: process.processNumberFormatted, processId: process.id } : null,
      status: latest?.name || 'Processo localizado; sem movimentações no portal',
    };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('A consulta ao portal do STF excedeu 25 segundos.', 504);
    if (error.statusCode) throw error;
    throw fail(`Não foi possível consultar o portal do STF: ${error.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
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
  const query = String(tracker.query || '').trim();
  if (query.length < 2) throw fail('Informe um tema ou número de processo para acompanhar.', 400);
  if (String(tracker.court || '').toLowerCase() === 'stf') return queryStf(tracker);
  const inferredCourt = inferCourtFromProcessNumber(query);
  if (inferredCourt === 'stf') {
    throw fail('Este número pertence ao STF, mas o DataJud não oferece índice público do STF. Use a consulta oficial do STF.', 400);
  }
  const court = normalizeCourt(inferredCourt || tracker.court);
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
      if (response.status === 404 && /no such index/i.test(String(detail))) {
        throw fail(`${courtLabel(court)} não possui índice público no DataJud. Escolha um tribunal disponível na lista.`, 400);
      }
      throw fail(`DataJud recusou a consulta (${detail}).`, response.status === 401 || response.status === 403 ? 502 : response.status);
    }
    return { ...summarizeDataJudResponse(body, court), court };
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

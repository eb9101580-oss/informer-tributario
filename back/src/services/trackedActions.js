import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { normalizeCourt, queryDataJud } from './datajud.js';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = resolve(here, '../../data/tracked-actions.json');
const localTempPath = `${localPath}.tmp`;
const githubPath = 'back/data/tracked-actions.json';

function actionMovementAlert(tracker, result, movement) {
  const now = new Date().toISOString();
  const tribunal = movement.court || result.court?.toUpperCase() || tracker.court?.toUpperCase();
  const sourceUrl = result.sourceUrl || `https://api-publica.datajud.cnj.jus.br/api_publica_${tracker.court}/_search`;
  return {
    id: `action-${tracker.id}-${movement.id}`,
    title: `${tracker.label}: ${movement.name}`,
    theme: tracker.label,
    agency: tribunal,
    taxes: [tracker.court?.toUpperCase() || 'PROCESSO'],
    status: movement.name,
    kind: 'Movimentação processual',
    impactType: 'Atenção',
    summary: `Foi registrada uma nova movimentação oficial no acompanhamento ${tracker.label}.`,
    whatChanged: movement.complement ? `${movement.name}. ${movement.complement}` : movement.name,
    practicalImpact: 'Revise o andamento, a decisão ou o prazo correspondente antes de orientar o cliente.',
    officeAction: `Conferir a publicação oficial e atualizar o controle do processo ${movement.processNumber || ''}.`.trim(),
    affectedProfiles: [],
    opportunity: null,
    score: 8.5,
    relevance: 'Alta relevância',
    officialUrl: sourceUrl,
    publishedAt: movement.date || now,
    createdAt: now,
    updatedAt: now,
    isDemo: false,
    movementId: movement.id,
    provenance: {
      collector: 'DataJud / portal oficial',
      analyzer: 'Regra de movimentação processual',
      collectorUrl: sourceUrl,
      sourceCharacters: 0,
      sourceId: `tracked-action-${tracker.court}`,
      sourceName: `Ação acompanhada · ${tribunal}`,
      discoveredBy: 'tracked-action-refresh',
      sourceType: 'official',
      documentKind: 'Movimentação processual oficial',
      discoveredAt: now,
    },
    sections: [],
  };
}

function encryptionKey() {
  return createHash('sha256').update(config.trackedActionsEncryptionKey).digest();
}

function requireEncryptionKey() {
  if (config.trackedActionsEncryptionKey) return;
  const error = new Error('TRACKED_ACTIONS_ENCRYPTION_KEY (ou SUBSCRIPTIONS_ENCRYPTION_KEY) não está configurada.');
  error.statusCode = 503;
  throw error;
}

function decryptTrackers(encrypted) {
  requireEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

function normalizeData(data = {}) {
  let trackers = Array.isArray(data.trackers) ? data.trackers : [];
  if (data.trackersEncrypted) trackers = decryptTrackers(data.trackersEncrypted);
  return { version: 1, trackers: Array.isArray(trackers) ? trackers : [] };
}

function serializeData(data) {
  requireEncryptionKey();
  const normalized = normalizeData(data);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(normalized.trackers), 'utf8'), cipher.final()]);
  return {
    version: 1,
    trackersEncrypted: {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    },
  };
}

async function readLocal() {
  try {
    return normalizeData(JSON.parse(await readFile(localPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeData();
    throw error;
  }
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function githubUrl() {
  return `https://api.github.com/repos/${config.githubRepository}/contents/${githubPath}`;
}

async function readGithub() {
  const response = await fetch(`${githubUrl()}?ref=main`, { headers: githubHeaders() });
  if (response.status === 404) return { data: normalizeData(), sha: null };
  if (!response.ok) throw new Error(`GitHub respondeu com status ${response.status} ao ler os acompanhamentos.`);
  const body = await response.json();
  const decoded = Buffer.from(String(body.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
  return { data: normalizeData(JSON.parse(decoded)), sha: body.sha || null };
}

async function writeGithub(data, sha = null) {
  if (!config.githubToken) {
    const error = new Error('GITHUB_TOKEN precisa ser configurado na Vercel para persistir acompanhamentos.');
    error.statusCode = 503;
    throw error;
  }
  const body = {
    message: 'Atualiza ações acompanhadas do DataJud',
    content: Buffer.from(JSON.stringify(serializeData(data), null, 2), 'utf8').toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;
  const response = await fetch(githubUrl(), { method: 'PUT', headers: githubHeaders(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`GitHub não conseguiu salvar os acompanhamentos (status ${response.status}).`);
  return normalizeData(data);
}

export function actionsPersistenceConfigured() {
  return Boolean(config.trackedActionsEncryptionKey) && (!config.serverless || Boolean(config.githubToken));
}

export function actionsStatus() {
  return {
    datajudConfigured: Boolean(config.datajudApiKey),
    persistenceConfigured: actionsPersistenceConfigured(),
    enabled: Boolean(config.datajudApiKey) && actionsPersistenceConfigured(),
  };
}

export async function readTrackedActions() {
  if (config.serverless && config.githubToken) return (await readGithub()).data;
  return readLocal();
}

async function writeTrackedActions(data) {
  requireEncryptionKey();
  if (config.serverless) {
    if (!config.githubToken) {
      const error = new Error('GITHUB_TOKEN e uma chave de criptografia precisam ser configurados na Vercel para persistir acompanhamentos.');
      error.statusCode = 503;
      throw error;
    }
    const current = await readGithub();
    return writeGithub(data, current.sha);
  }
  await writeFile(localTempPath, JSON.stringify(serializeData(data), null, 2), 'utf8');
  await rename(localTempPath, localPath);
  return normalizeData(data);
}

function validateInput(input = {}) {
  const label = String(input.label || '').trim();
  const query = String(input.query || '').trim();
  if (label.length < 2 || label.length > 120) {
    const error = new Error('Dê um nome ao acompanhamento (entre 2 e 120 caracteres).');
    error.statusCode = 400;
    throw error;
  }
  if (query.length < 2 || query.length > 160) {
    const error = new Error('Informe um tema ou número de processo válido.');
    error.statusCode = 400;
    throw error;
  }
  return { label, query, court: normalizeCourt(input.court || 'stj') };
}

export async function addTrackedAction(input) {
  if (!config.datajudApiKey || !actionsPersistenceConfigured()) {
    const error = new Error('Configure DATAJUD_API_KEY e TRACKED_ACTIONS_ENCRYPTION_KEY (e GITHUB_TOKEN na Vercel) para salvar acompanhamentos.');
    error.statusCode = 503;
    throw error;
  }
  const values = validateInput(input);
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const now = new Date().toISOString();
  const tracker = {
    id: randomUUID(),
    ...values,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    status: 'Aguardando primeira consulta',
    resultCount: 0,
    processCount: 0,
    latestMovement: null,
    movements: [],
    processes: [],
    lastError: null,
  };
  const saved = await writeTrackedActions({ trackers: [tracker, ...current.trackers] });
  return saved.trackers[0];
}

export async function updateTrackedAction(id, input) {
  if (!config.datajudApiKey || !actionsPersistenceConfigured()) {
    const error = new Error('Configure DATAJUD_API_KEY e TRACKED_ACTIONS_ENCRYPTION_KEY (e GITHUB_TOKEN na Vercel) para salvar acompanhamentos.');
    error.statusCode = 503;
    throw error;
  }
  const values = validateInput(input);
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const index = current.trackers.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error('Acompanhamento não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  current.trackers[index] = {
    ...current.trackers[index],
    ...values,
    updatedAt: now,
    lastCheckedAt: null,
    status: 'Aguardando nova consulta',
    resultCount: 0,
    processCount: 0,
    latestMovement: null,
    movements: [],
    processes: [],
    lastError: null,
  };
  await writeTrackedActions(current);
  return current.trackers[index];
}

export async function removeTrackedAction(id) {
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const trackers = current.trackers.filter((item) => item.id !== id);
  if (trackers.length === current.trackers.length) return false;
  await writeTrackedActions({ trackers });
  return true;
}

export async function refreshTrackedAction(id) {
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const index = current.trackers.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error('Acompanhamento não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const tracker = current.trackers[index];
  const checkedAt = new Date().toISOString();
  try {
    const result = await queryDataJud(tracker);
    const updated = {
      ...tracker,
      ...result,
      movementAlerts: result.latestMovement && !(tracker.movementAlerts || []).some((alert) => alert.movementId === result.latestMovement.id)
        ? [actionMovementAlert(tracker, result, result.latestMovement), ...(tracker.movementAlerts || [])].slice(0, 50)
        : (tracker.movementAlerts || []),
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
      lastError: null,
    };
    current.trackers[index] = updated;
    await writeTrackedActions(current);
    return updated;
  } catch (error) {
    current.trackers[index] = { ...tracker, lastCheckedAt: checkedAt, updatedAt: checkedAt, lastError: error.message };
    if (actionsPersistenceConfigured()) await writeTrackedActions(current);
    throw error;
  }
}

export async function refreshAllTrackedActions() {
  const current = await readTrackedActions();
  const results = [];
  for (const tracker of current.trackers) {
    try {
      results.push(await refreshTrackedAction(tracker.id));
    } catch (error) {
      results.push({ ...tracker, lastError: error.message });
    }
  }
  return results;
}

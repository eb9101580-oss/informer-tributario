import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { normalizeCourt, publicSourceUrl, queryDataJud } from './datajud.js';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = resolve(here, '../../data/tracked-actions.json');
const localTempPath = `${localPath}.tmp`;
const githubPath = 'back/data/tracked-actions.json';

function actionMovementAlert(tracker, result, movement) {
  const now = new Date().toISOString();
  const tribunal = movement.court || result.court?.toUpperCase() || tracker.court?.toUpperCase();
  const sourceUrl = publicSourceUrl(result.court || tracker.court, tracker.query, result.sourceUrl);
  const stableMovementKey = movementKey(movement);
  return {
    id: `action-${tracker.id}-${createHash('sha256').update(stableMovementKey).digest('hex').slice(0, 32)}`,
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
    movementKey: stableMovementKey,
    ownerId: tracker.ownerId || null,
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

function sanitizeTracker(tracker = {}) {
  const sourceUrl = publicSourceUrl(tracker.court, tracker.query, tracker.sourceUrl);
  const movementAlerts = (tracker.movementAlerts || []).map((alert) => {
    const officialUrl = publicSourceUrl(tracker.court, tracker.query, alert.officialUrl);
    const collectorUrl = publicSourceUrl(tracker.court, tracker.query, alert.provenance?.collectorUrl);
    return {
      ...alert,
      officialUrl,
      provenance: alert.provenance ? { ...alert.provenance, collectorUrl } : alert.provenance,
    };
  });
  return { ...tracker, sourceUrl, publicUrl: sourceUrl, movementAlerts };
}

export function movementKey(movement = {}) {
  const processKey = movement.processId || movement.processNumber || 'processo';
  const movementIdentifier = movement.id || createHash('sha256')
    .update(`${movement.date || ''}|${movement.name || ''}|${movement.complement || ''}`)
    .digest('hex')
    .slice(0, 20);
  return `${processKey}:${movementIdentifier}`;
}

export function newMovementAlerts(tracker, result) {
  const previousAlerts = tracker.movementAlerts || [];
  const previousMovements = tracker.movements || [];
  const known = new Set([
    ...previousAlerts.map((alert) => alert.movementKey || `${alert.processId || alert.processNumber || 'processo'}:${alert.movementId}`),
    ...previousMovements.map(movementKey),
  ]);
  const movements = Array.isArray(result.movements) ? result.movements : [];
  const isFirstSnapshot = !tracker.lastCheckedAt && previousMovements.length === 0;
  const unseen = movements.filter((movement) => !known.has(movementKey(movement)));
  const selected = isFirstSnapshot ? unseen.slice(0, 1) : unseen;
  return selected.map((movement) => actionMovementAlert(tracker, result, movement));
}

export function hasTrackedActionStateChanged(previous = {}, next = {}) {
  const stableState = (tracker) => {
    const { lastCheckedAt, updatedAt, ...state } = tracker;
    return state;
  };
  return JSON.stringify(stableState(previous)) !== JSON.stringify(stableState(next));
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
  try {
    requireEncryptionKey();
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, 'base64')),
      decipher.final(),
    ]).toString('utf8'));
  } catch (cause) {
    if (cause.statusCode === 503) throw cause;
    const error = new Error('Os acompanhamentos foram criptografados com outra chave. O arquivo original foi preservado.');
    error.statusCode = 503;
    error.code = 'TRACKED_ACTIONS_DECRYPTION_FAILED';
    error.cause = cause;
    throw error;
  }
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
  const data = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  return { ...data, trackers: data.trackers.map(sanitizeTracker) };
}

export function trackersVisibleToActor(trackers = [], actor = null) {
  if (actor?.isSystem || actor?.isAdmin) return trackers;
  if (!actor?.userId) return [];
  return trackers.filter((tracker) => tracker.ownerId && tracker.ownerId === actor.userId);
}

export async function readTrackedActionsForUser(user) {
  const data = await readTrackedActions();
  const isAdmin = String(user?.role || '').split(',').map((role) => role.trim()).includes('admin');
  return { ...data, trackers: trackersVisibleToActor(data.trackers, { userId: user?.id, isAdmin }) };
}

function assertTrackerAccess(tracker, actor) {
  if (actor?.isSystem || actor?.isAdmin || (tracker.ownerId && tracker.ownerId === actor?.userId)) return;
  const error = new Error('Acompanhamento não encontrado.');
  error.statusCode = 404;
  throw error;
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

export async function addTrackedAction(input, ownerId = null) {
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
    ownerId,
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

export async function updateTrackedAction(id, input, actor = null) {
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
  assertTrackerAccess(current.trackers[index], actor);
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

export async function removeTrackedAction(id, actor = null) {
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const tracker = current.trackers.find((item) => item.id === id);
  if (tracker) assertTrackerAccess(tracker, actor);
  const trackers = current.trackers.filter((item) => item.id !== id);
  if (trackers.length === current.trackers.length) return false;
  await writeTrackedActions({ trackers });
  return true;
}

export async function refreshTrackedAction(id, actor = null) {
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const index = current.trackers.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error('Acompanhamento não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  assertTrackerAccess(current.trackers[index], actor);
  const tracker = sanitizeTracker(current.trackers[index]);
  current.trackers[index] = tracker;
  const checkedAt = new Date().toISOString();
  try {
    const result = await queryDataJud(tracker);
    const generatedAlerts = newMovementAlerts(tracker, result);
    const updated = {
      ...tracker,
      ...result,
      movementAlerts: [...generatedAlerts, ...(tracker.movementAlerts || [])].slice(0, 100),
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
      lastError: null,
    };
    current.trackers[index] = updated;
    if (hasTrackedActionStateChanged(tracker, updated)) await writeTrackedActions(current);
    return { ...updated, newMovementAlerts: generatedAlerts };
  } catch (error) {
    const failed = { ...tracker, lastCheckedAt: checkedAt, updatedAt: checkedAt, lastError: error.message };
    current.trackers[index] = failed;
    if (actionsPersistenceConfigured() && hasTrackedActionStateChanged(tracker, failed)) await writeTrackedActions(current);
    throw error;
  }
}

export async function refreshAllTrackedActions(actor = null) {
  if (!actor?.isSystem && !actor?.isAdmin && !actor?.userId) {
    const error = new Error('Autenticação obrigatória para atualizar acompanhamentos.');
    error.statusCode = 401;
    throw error;
  }
  const current = await readTrackedActions();
  const trackers = trackersVisibleToActor(current.trackers, actor);
  const results = [];
  for (const tracker of trackers) {
    try {
      results.push(await refreshTrackedAction(tracker.id, actor));
    } catch (error) {
      results.push({ ...tracker, lastError: error.message });
    }
  }
  return results;
}

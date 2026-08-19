import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = resolve(here, '../../data/subscriptions.json');
const localTempPath = `${localPath}.tmp`;
const githubPath = 'back/data/subscriptions.json';

function normalizeData(data = {}) {
  let subscribers = Array.isArray(data.subscribers) ? data.subscribers : [];
  if (data.subscribersEncrypted) {
    if (!config.subscriptionEncryptionKey) {
      const error = new Error('SUBSCRIPTIONS_ENCRYPTION_KEY não está configurada para ler os cadastros protegidos.');
      error.statusCode = 503;
      throw error;
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(data.subscribersEncrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(data.subscribersEncrypted.tag, 'base64'));
    subscribers = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.subscribersEncrypted.data, 'base64')), decipher.final()]).toString('utf8'));
  }
  return {
    version: 1,
    subscribers: Array.isArray(subscribers) ? subscribers : [],
    notifiedAlertIds: Array.isArray(data.notifiedAlertIds) ? data.notifiedAlertIds : [],
  };
}

function encryptionKey() {
  return createHash('sha256').update(config.subscriptionEncryptionKey).digest();
}

function serializeData(data) {
  const normalized = normalizeData(data);
  if (!config.subscriptionEncryptionKey) {
    const error = new Error('SUBSCRIPTIONS_ENCRYPTION_KEY precisa ser configurada para salvar cadastros com segurança.');
    error.statusCode = 503;
    throw error;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(normalized.subscribers), 'utf8'), cipher.final()]);
  return {
    version: 1,
    subscribersEncrypted: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') },
    notifiedAlertIds: normalized.notifiedAlertIds,
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
  if (!response.ok) throw new Error(`GitHub respondeu com status ${response.status} ao ler os cadastros.`);
  const body = await response.json();
  const decoded = Buffer.from(String(body.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
  return { data: normalizeData(JSON.parse(decoded)), sha: body.sha || null };
}

async function writeGithub(data, sha = null) {
  if (!config.githubToken) {
    const error = new Error('O cadastro de e-mail precisa de GITHUB_TOKEN configurado na Vercel para ter persistência.');
    error.statusCode = 503;
    throw error;
  }
  const body = {
    message: 'Atualiza assinaturas de alertas tributários',
    content: Buffer.from(JSON.stringify(serializeData(data), null, 2), 'utf8').toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;
  const response = await fetch(githubUrl(), { method: 'PUT', headers: githubHeaders(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`GitHub não conseguiu salvar o cadastro (status ${response.status}).`);
  return normalizeData(data);
}

export async function readSubscriptions() {
  if (config.serverless && config.githubToken) return (await readGithub()).data;
  return readLocal();
}

async function writeSubscriptions(data) {
  if (config.serverless) {
    if (!config.githubToken || !config.subscriptionEncryptionKey) {
      const error = new Error('O cadastro de e-mail precisa de GITHUB_TOKEN e SUBSCRIPTIONS_ENCRYPTION_KEY configurados na Vercel.');
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

export async function addSubscription(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error('Informe um e-mail válido.');
    error.statusCode = 400;
    throw error;
  }
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const existing = current.subscribers.find((item) => item.email === normalizedEmail);
  if (existing) return { subscriber: existing, created: false };
  const subscriber = { id: randomUUID(), email: normalizedEmail, active: true, createdAt: new Date().toISOString() };
  await writeSubscriptions({ ...current, subscribers: [subscriber, ...current.subscribers] });
  return { subscriber, created: true };
}

export async function markAlertsNotified(alertIds) {
  const current = config.serverless && config.githubToken ? (await readGithub()).data : await readLocal();
  const ids = new Set(current.notifiedAlertIds);
  alertIds.forEach((id) => ids.add(id));
  return writeSubscriptions({ ...current, notifiedAlertIds: [...ids].slice(-5000) });
}

import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../../data/database.json');
const tempPath = `${dataPath}.tmp`;
let writeQueue = Promise.resolve();

async function readBundledDatabase() {
  const content = await readFile(dataPath, 'utf8');
  return JSON.parse(content);
}

async function readGitHubDatabase() {
  const repository = process.env.GITHUB_REPOSITORY || 'eb9101580-oss/informer-tributario';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repositório GitHub inválido.');
  // O CDN do raw.githubusercontent.com pode manter o conteúdo anterior mesmo
  // com cache:no-store. Um bucket curto força a leitura do commit recém-gravado
  // sem criar uma URL diferente para cada acesso ao feed.
  const cacheVersion = Math.floor(Date.now() / 30_000);
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/main/back/data/database.json?v=${cacheVersion}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Informer-Tributario/1.0', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub respondeu com status ${response.status}.`);
  return response.json();
}

export async function readDatabase() {
  if (process.env.VERCEL === '1') {
    try { return await readGitHubDatabase(); }
    catch (error) { console.warn(`Falha ao ler o feed atualizado no GitHub; usando a cópia do deploy: ${error.message}`); }
  }
  return readBundledDatabase();
}

export function updateDatabase(updater) {
  writeQueue = writeQueue.then(async () => {
    const database = await readDatabase();
    const updated = await updater(database);
    await writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf8');
    await rename(tempPath, dataPath);
    return updated;
  });

  return writeQueue;
}

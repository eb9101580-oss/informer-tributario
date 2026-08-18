import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../../data/database.json');
const tempPath = `${dataPath}.tmp`;
let writeQueue = Promise.resolve();

export async function readDatabase() {
  const content = await readFile(dataPath, 'utf8');
  return JSON.parse(content);
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

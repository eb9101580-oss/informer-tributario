import test from 'node:test';
import assert from 'node:assert/strict';
import { readDatabase } from '../src/services/store.js';

test('Vercel lê o banco mais recente do GitHub sem depender de novo deploy', async () => {
  const originalVercel = process.env.VERCEL;
  const originalRepository = process.env.GITHUB_REPOSITORY;
  const originalFetch = global.fetch;
  process.env.VERCEL = '1';
  process.env.GITHUB_REPOSITORY = 'org/projeto';
  global.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.origin + requestUrl.pathname, 'https://raw.githubusercontent.com/org/projeto/main/back/data/database.json');
    assert.match(requestUrl.searchParams.get('v'), /^\d+$/);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    return { ok: true, json: async () => ({ alerts: [{ id: 'novo-alerta' }] }) };
  };

  try {
    const database = await readDatabase();
    assert.equal(database.alerts[0].id, 'novo-alerta');
  } finally {
    global.fetch = originalFetch;
    if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
    if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = originalRepository;
  }
});

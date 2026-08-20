import test from 'node:test';
import assert from 'node:assert/strict';
import { readDatabase } from '../src/services/store.js';

test('Vercel lê o banco mais recente do GitHub sem depender de novo deploy', async () => {
  const originalVercel = process.env.VERCEL;
  const originalRepository = process.env.GITHUB_REPOSITORY;
  const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const originalFetch = global.fetch;
  process.env.VERCEL = '1';
  process.env.GITHUB_REPOSITORY = 'org/projeto';
  process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://raw.githubusercontent.com/org/projeto/0123456789abcdef0123456789abcdef01234567/back/data/database.json');
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
    if (originalCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA; else process.env.VERCEL_GIT_COMMIT_SHA = originalCommit;
  }
});

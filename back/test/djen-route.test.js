import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../src/app.js';
import { clearDjenMetadataCache, normalizeDjenMetadataParams } from '../src/routes/djen.js';

test('valida tribunal e data civil do proxy do DJEN', () => {
  assert.deepEqual(normalizeDjenMetadataParams('trf3', '2026-08-19'), { tribunal: 'TRF3', date: '2026-08-19' });
  assert.throws(() => normalizeDjenMetadataParams('STJ', '2026-08-19'), /Tribunal inválido/);
  assert.throws(() => normalizeDjenMetadataParams('TRF1', '2026-02-30'), /Data inválida/);
  assert.throws(() => normalizeDjenMetadataParams('TRF1', '19-08-2026'), /Data inválida/);
});

test('rota pública encaminha os metadados oficiais e reutiliza o cache', async () => {
  clearDjenMetadataCache();
  const originalFetch = global.fetch;
  const payload = {
    sigla_tribunal: 'TRF1',
    data: '2026-08-19',
    status: 'Processado',
    total_comunicacoes: 33731,
    url: 'https://djen-prd.prd.s3.cnj.jus.br/cadernos/TRF1.zip?assinatura=teste',
  };
  let upstreamCalls = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://comunicaapi.pje.jus.br/api/v1/caderno/')) {
      upstreamCalls += 1;
      assert.equal(String(url), 'https://comunicaapi.pje.jus.br/api/v1/caderno/TRF1/2026-08-19/D');
      assert.equal(options.headers.Accept, 'application/json');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, options);
  };

  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const first = await originalFetch(`http://127.0.0.1:${port}/api/djen/caderno-metadata/trf1/2026-08-19`);
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control'), /s-maxage=120/);
    assert.equal(first.headers.get('x-informer-cache'), 'MISS');
    assert.deepEqual(await first.json(), payload);

    const second = await originalFetch(`http://127.0.0.1:${port}/api/djen/caderno-metadata/TRF1/2026-08-19`);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-informer-cache'), 'HIT');
    assert.deepEqual(await second.json(), payload);
    assert.equal(upstreamCalls, 1);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    clearDjenMetadataCache();
  }
});

test('rota rejeita parâmetros inválidos antes de consultar o DJEN', async () => {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const tribunal = await fetch(`http://127.0.0.1:${port}/api/djen/caderno-metadata/STJ/2026-08-19`);
    assert.equal(tribunal.status, 400);
    const date = await fetch(`http://127.0.0.1:${port}/api/djen/caderno-metadata/TRF1/2026-02-30`);
    assert.equal(date.status, 400);
  } finally {
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  }
});

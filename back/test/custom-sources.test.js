import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localCustomSources,
  queryActiveCustomSources,
  sourceFromRow,
} from '../src/services/customSources.js';

test('inicializa o schema antes de consultar fontes personalizadas ativas', async () => {
  const calls = [];
  const items = await queryActiveCustomSources({
    ensureSchema: async () => { calls.push('schema'); },
    queryFn: async (sql) => {
      calls.push('query');
      assert.match(sql, /status = 'active'/);
      return { rows: [{ id: 'source-1', name: 'Fonte Fiscal', url: 'https://example.test/tributos', category: 'Notícias', source_type: 'journalistic' }] };
    },
  });

  assert.deepEqual(calls, ['schema', 'query']);
  assert.equal(items[0].id, 'custom-source-1');
  assert.equal(items[0].adapter, 'custom-links');
});

test('loader local não acessa schema nem banco quando DATABASE_URL não existe', async () => {
  let touchedPersistence = false;
  const items = await localCustomSources({
    isDatabaseConfigured: () => false,
    ensureSchema: async () => { touchedPersistence = true; },
    queryFn: async () => { touchedPersistence = true; return { rows: [] }; },
  });

  assert.deepEqual(items, []);
  assert.equal(touchedPersistence, false);
});

test('normaliza linha aprovada no formato aceito pelo coletor', () => {
  const source = sourceFromRow({
    id: 'abc',
    name: 'Portal Tributário',
    url: 'https://example.test/fiscal',
    category: null,
    source_type: 'official',
  });
  assert.equal(source.id, 'custom-abc');
  assert.equal(source.sourceType, 'official');
  assert.equal(source.custom, true);
});

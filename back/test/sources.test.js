import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';

test('expõe Congresso, tribunais, CARF e administração fiscal', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/sources`);
  const body = await response.json();
  const ids = body.items.map((source) => source.id);

  assert.equal(response.status, 200);
  assert.ok(body.total >= 36);
  assert.ok(body.journalistic >= 4);
  assert.ok(ids.includes('jota'));
  assert.ok(['receita-cosit', 'receita-in', 'receita-notas', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'stj-informativos', 'stf-informativos', 'pgfn-pareceres'].every((id) => ids.includes(id)));
  assert.ok(['camara', 'senado', 'stf', 'stj', 'carf', 'trf1', 'trf6'].every((id) => ids.includes(id)));
  assert.ok(body.items.every((source) => source.url.startsWith('https://')));
});

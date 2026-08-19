import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';

test('expõe o status do cadastro de alertas por e-mail', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/subscriptions/status`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.threshold, 8);
  assert.equal(typeof body.enabled, 'boolean');
});

test('recusa cadastro sem e-mail válido', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/subscriptions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalido' }),
  });

  assert.equal(response.status, 400);
});

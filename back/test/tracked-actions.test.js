import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTrackedActionStateChanged } from '../src/services/trackedActions.js';

test('consulta sem movimentação nova não exige nova persistência', () => {
  const previous = { id: 'acao-1', status: 'Publicação', lastCheckedAt: '2026-08-19T10:00:00Z', updatedAt: '2026-08-19T10:00:00Z', movements: [{ id: 'mov-1' }], lastError: null };
  const checkedAgain = { ...previous, lastCheckedAt: '2026-08-19T10:10:00Z', updatedAt: '2026-08-19T10:10:00Z' };
  assert.equal(hasTrackedActionStateChanged(previous, checkedAgain), false);
});

test('movimentação nova exige persistência e alerta', () => {
  const previous = { id: 'acao-1', movements: [{ id: 'mov-1' }], movementAlerts: [] };
  const updated = { ...previous, movements: [{ id: 'mov-2' }, ...previous.movements], movementAlerts: [{ movementId: 'mov-2' }] };
  assert.equal(hasTrackedActionStateChanged(previous, updated), true);
});

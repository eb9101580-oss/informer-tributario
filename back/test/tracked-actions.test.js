import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTrackedActionStateChanged, movementKey, newMovementAlerts, trackersVisibleToActor } from '../src/services/trackedActions.js';

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

test('movimentações com o mesmo id em processos diferentes não colidem', () => {
  assert.notEqual(
    movementKey({ id: 'mov-1', processId: 'processo-a' }),
    movementKey({ id: 'mov-1', processId: 'processo-b' }),
  );
  const tracker = { id: 'acao-1', label: 'Tema tributário', court: 'stj', lastCheckedAt: '2026-08-19T10:00:00Z', movements: [], movementAlerts: [] };
  const alerts = newMovementAlerts(tracker, {
    court: 'stj', sourceUrl: 'https://processo.stj.jus.br/', movements: [
      { id: 'mov-1', processId: 'processo-a', name: 'Publicação' },
      { id: 'mov-1', processId: 'processo-b', name: 'Publicação' },
    ],
  });
  assert.notEqual(alerts[0].id, alerts[1].id);
});

test('checagem diária cria alerta para todas as movimentações ainda não vistas', () => {
  const tracker = {
    id: 'acao-1', label: 'Tema tributário', court: 'stj', lastCheckedAt: '2026-08-19T10:00:00Z',
    movements: [{ id: 'mov-1', processId: 'processo-a' }], movementAlerts: [],
  };
  const result = {
    court: 'stj', sourceUrl: 'https://processo.stj.jus.br/',
    movements: [
      { id: 'mov-3', processId: 'processo-a', name: 'Publicação', date: '2026-08-20T10:00:00Z' },
      { id: 'mov-2', processId: 'processo-a', name: 'Julgamento', date: '2026-08-20T09:00:00Z' },
      { id: 'mov-1', processId: 'processo-a', name: 'Conclusão', date: '2026-08-19T09:00:00Z' },
    ],
  };
  const alerts = newMovementAlerts(tracker, result);
  assert.deepEqual(alerts.map((item) => item.movementId), ['mov-3', 'mov-2']);
});

test('primeira fotografia envia somente a movimentação mais recente', () => {
  const tracker = { id: 'acao-1', label: 'Tema tributário', court: 'stj', movements: [], movementAlerts: [] };
  const result = {
    court: 'stj', sourceUrl: 'https://processo.stj.jus.br/',
    movements: [
      { id: 'mov-2', processId: 'processo-a', name: 'Publicação', date: '2026-08-20T10:00:00Z' },
      { id: 'mov-1', processId: 'processo-a', name: 'Conclusão', date: '2026-08-19T09:00:00Z' },
    ],
  };
  assert.deepEqual(newMovementAlerts(tracker, result).map((item) => item.movementId), ['mov-2']);
});

test('usuário vê somente ações próprias e ações legadas ficam restritas ao admin', () => {
  const trackers = [
    { id: 'propria', ownerId: 'user-1' },
    { id: 'alheia', ownerId: 'user-2' },
    { id: 'legada' },
  ];
  assert.deepEqual(trackersVisibleToActor(trackers, { userId: 'user-1' }).map((item) => item.id), ['propria']);
  assert.deepEqual(trackersVisibleToActor(trackers, { userId: 'admin-1', isAdmin: true }).map((item) => item.id), ['propria', 'alheia', 'legada']);
  assert.deepEqual(trackersVisibleToActor(trackers, null), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledBackfillDate } from '../src/services/historySweep.js';

test('varredura historica percorre as datas dos 61 dias anteriores', () => {
  const dates = new Set();
  const start = new Date('2026-08-19T03:07:00Z');
  for (let slot = 0; slot < 61; slot += 1) {
    dates.add(scheduledBackfillDate(new Date(start.getTime() + slot * 20 * 60 * 1000), 62, 20));
  }
  assert.equal(dates.size, 61);
  assert.equal(dates.has('2026-08-19'), false);
  assert.equal([...dates].every((date) => date >= '2026-06-19' && date <= '2026-08-18'), true);
});

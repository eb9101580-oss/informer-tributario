import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledBackfillDate } from '../src/services/historySweep.js';

test('varredura historica percorre os seis dias anteriores', () => {
  const dates = new Set();
  const start = new Date('2026-08-19T03:07:00Z');
  for (let slot = 0; slot < 6; slot += 1) {
    dates.add(scheduledBackfillDate(new Date(start.getTime() + slot * 20 * 60 * 1000), 7, 20));
  }
  assert.equal(dates.size, 6);
  assert.equal(dates.has('2026-08-19'), false);
  assert.equal([...dates].every((date) => date >= '2026-08-13' && date <= '2026-08-18'), true);
});

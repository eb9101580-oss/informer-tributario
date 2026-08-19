import { publicationDateKey } from './feedWindow.js';

export function scheduledBackfillDate(now = new Date()) {
  const today = publicationDateKey(now);
  const target = new Date(`${today}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

import { publicationDateKey } from './feedWindow.js';

const MINUTE_MS = 60 * 1000;

export function scheduledBackfillDate(now = new Date(), lookbackDays = 7, intervalMinutes = 20) {
  const days = Math.min(7, Math.max(2, Number(lookbackDays) || 7));
  const interval = Math.max(1, Number(intervalMinutes) || 20);
  const slot = Math.floor(now.getTime() / (interval * MINUTE_MS));
  const ageInDays = 1 + (slot % (days - 1));
  const today = publicationDateKey(now);
  const target = new Date(`${today}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() - ageInDays);
  return target.toISOString().slice(0, 10);
}

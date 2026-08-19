const DAY_MS = 24 * 60 * 60 * 1000;
export const FEED_WINDOW_DAYS = 7;
const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';
const brazilDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BRAZIL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateKeyFromDate(date) {
  const parts = Object.fromEntries(brazilDateFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function publicationDateKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const calendarDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (calendarDate) return calendarDate[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateKeyFromDate(date);
}

export function isPublishedWithinDays(value, days = FEED_WINDOW_DAYS, now = new Date(), { allowUnknown = false } = {}) {
  const key = publicationDateKey(value);
  if (!key) return allowUnknown;
  const today = dateKeyFromDate(now);
  const itemOrdinal = Date.parse(`${key}T00:00:00Z`);
  const todayOrdinal = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(itemOrdinal) || !Number.isFinite(todayOrdinal)) return allowUnknown;
  const ageInDays = Math.floor((todayOrdinal - itemOrdinal) / DAY_MS);
  return ageInDays >= 0 && ageInDays < Math.max(1, days);
}

export function isCurrentFeedItem(item, now = new Date()) {
  return isPublishedWithinDays(item?.publishedAt, FEED_WINDOW_DAYS, now);
}

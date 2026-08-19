const DAY_MS = 24 * 60 * 60 * 1000;

export function alertPublishedTimestamp(alert) {
  const published = Date.parse(alert?.publishedAt || '');
  if (Number.isFinite(published)) return published;
  const created = Date.parse(alert?.createdAt || '');
  return Number.isFinite(created) ? created : 0;
}

export function isRecentAlert(alert, now = Date.now()) {
  return now - alertPublishedTimestamp(alert) <= 30 * DAY_MS;
}

/**
 * Keeps the feed current without hiding older decisions and manuals.
 * Items published in the last 30 days come first; score orders items
 * inside each freshness group, followed by the publication date.
 */
export function compareFeedAlerts(left, right, now = Date.now()) {
  const leftDate = alertPublishedTimestamp(left);
  const rightDate = alertPublishedTimestamp(right);
  const leftRecent = isRecentAlert(left, now) ? 0 : 1;
  const rightRecent = isRecentAlert(right, now) ? 0 : 1;
  return leftRecent - rightRecent
    || ((right.score || 0) - (left.score || 0))
    || (rightDate - leftDate);
}

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

/** Orders the feed chronologically; score is only a tie-breaker. */
export function compareFeedAlerts(left, right) {
  const leftDate = alertPublishedTimestamp(left);
  const rightDate = alertPublishedTimestamp(right);
  return (rightDate - leftDate) || ((right.score || 0) - (left.score || 0));
}

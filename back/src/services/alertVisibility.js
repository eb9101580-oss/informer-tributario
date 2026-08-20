import { readTrackedActionsForUser } from './trackedActions.js';

function isAdmin(user) {
  return String(user?.role || '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .includes('admin');
}

export function isPrivateTrackedAlert(alert = {}) {
  return Boolean(alert.ownerId)
    || String(alert.provenance?.sourceId || '').startsWith('tracked-action-');
}

function storedAlertsForViewer(alerts, authSession) {
  const user = authSession?.user;
  return alerts.filter((alert) => {
    if (!isPrivateTrackedAlert(alert)) return true;
    if (!user) return false;
    if (isAdmin(user)) return true;
    return Boolean(alert.ownerId) && alert.ownerId === user.id;
  });
}

export async function movementAlertsForViewer(
  authSession,
  { readTrackedActionsForUserFn = readTrackedActionsForUser } = {},
) {
  if (!authSession?.user) return [];

  try {
    const tracked = await readTrackedActionsForUserFn(authSession.user);
    return tracked.trackers.flatMap((tracker) => tracker.movementAlerts || []);
  } catch (error) {
    // The global feed remains available when optional action persistence is unavailable.
    if (error.statusCode === 503) return [];
    throw error;
  }
}

export async function alertsForViewer(database, authSession, dependencies) {
  const storedAlerts = storedAlertsForViewer(database.alerts, authSession);
  const movementAlerts = await movementAlertsForViewer(authSession, dependencies);
  const unique = new Map(storedAlerts.map((alert) => [alert.id, alert]));
  movementAlerts.forEach((alert) => unique.set(alert.id, alert));
  return [...unique.values()];
}

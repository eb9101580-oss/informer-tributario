import { Router } from 'express';
import { readDatabase } from '../services/store.js';
import { isCurrentFeedItem } from '../services/feedWindow.js';
import { alertsForViewer } from '../services/alertVisibility.js';
import { optionalAuth } from '../middleware/auth.js';
import { loadMonitoredSources } from '../services/customSources.js';

export function createDashboardRouter({
  optionalAuthMiddleware = optionalAuth,
  readDatabaseFn = readDatabase,
  readTrackedActionsForUserFn,
  loadMonitoredSourcesFn = loadMonitoredSources,
} = {}) {
  const router = Router();

  router.get('/', optionalAuthMiddleware, async (request, response, next) => {
    try {
      const [database, sources] = await Promise.all([readDatabaseFn(), loadMonitoredSourcesFn()]);
      const visibleAlerts = await alertsForViewer(database, request.auth, { readTrackedActionsForUserFn });
      const relevant = visibleAlerts.filter((alert) => alert.isDemo === false
        && alert.score >= 6
        && /^https:\/\//i.test(alert.officialUrl || '')
        && Boolean(alert.provenance?.sourceId)
        && isCurrentFeedItem(alert));
      const urgent = relevant.filter((alert) => alert.score >= 8);
      const opportunities = relevant.filter((alert) => ['Oportunidade', 'Ambos'].includes(alert.impactType));

      response.json({
        metrics: {
          relevant: relevant.length,
          urgent: urgent.length,
          opportunities: opportunities.length,
          monitoredSources: sources.length,
        },
        opportunities: opportunities.slice(0, 4),
        lastUpdatedAt: database.meta.lastUpdatedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const dashboardRouter = createDashboardRouter();

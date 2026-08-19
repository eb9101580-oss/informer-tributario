import { Router } from 'express';
import { readDatabase } from '../services/store.js';
import { monitoredSources } from '../data/officialSources.js';
import { readTrackedActions } from '../services/trackedActions.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_request, response, next) => {
  try {
    const database = await readDatabase();
    let movementAlerts = [];
    try {
      const tracked = await readTrackedActions();
      movementAlerts = tracked.trackers.flatMap((tracker) => tracker.movementAlerts || []);
    } catch (error) {
      if (error.statusCode !== 503) throw error;
    }
    const relevant = [...database.alerts, ...movementAlerts].filter((alert) => alert.isDemo === false
      && alert.score >= 6
      && /^https:\/\//i.test(alert.officialUrl || '')
      && Boolean(alert.provenance?.sourceId));
    const urgent = relevant.filter((alert) => alert.score >= 8);
    const opportunities = relevant.filter((alert) => ['Oportunidade', 'Ambos'].includes(alert.impactType));

    response.json({
      metrics: {
        relevant: relevant.length,
        urgent: urgent.length,
        opportunities: opportunities.length,
        monitoredSources: monitoredSources.length,
      },
      opportunities: opportunities.slice(0, 4),
      lastUpdatedAt: database.meta.lastUpdatedAt,
    });
  } catch (error) {
    next(error);
  }
});

import { Router } from 'express';
import { readDatabase } from '../services/store.js';
import { officialSources } from '../data/officialSources.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_request, response, next) => {
  try {
    const database = await readDatabase();
    const relevant = database.alerts.filter((alert) => alert.isDemo === false
      && alert.score >= 6
      && /^https:\/\//i.test(alert.officialUrl || '')
      && Boolean(alert.provenance?.sourceId));
    const urgent = relevant.filter((alert) => alert.score >= 9);
    const opportunities = relevant.filter((alert) => ['Oportunidade', 'Ambos'].includes(alert.impactType));

    response.json({
      metrics: {
        relevant: relevant.length,
        urgent: urgent.length,
        opportunities: opportunities.length,
        monitoredSources: officialSources.length,
      },
      opportunities: opportunities.slice(0, 4),
      lastUpdatedAt: database.meta.lastUpdatedAt,
    });
  } catch (error) {
    next(error);
  }
});

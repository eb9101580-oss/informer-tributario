import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readDatabase, updateDatabase } from '../services/store.js';
import { calculateScore, relevanceLabel } from '../services/scoring.js';
import { sectionIdsForSource } from '../data/sections.js';
import { isCurrentFeedItem } from '../services/feedWindow.js';
import { alertsForViewer } from '../services/alertVisibility.js';
import { optionalAuth, requireAdmin } from '../middleware/auth.js';
import { isExcludedTaxTopic } from '../services/sourceAdapters.js';

function isOfficialRelevantAlert(alert) {
  return alert.isDemo === false && alert.score >= 6 && /^https:\/\//i.test(alert.officialUrl || '')
    && Boolean(alert.provenance?.sourceId)
    && alert.provenance?.analysisMode !== 'fast-triage'
    && !isExcludedTaxTopic(alert.title, alert.summary, alert.whatChanged, alert.practicalImpact, alert.theme, alert.taxes);
}

function normalizeAlert(payload, current = {}) {
  const score = payload.criteria ? calculateScore(payload.criteria) : (payload.score ?? current.score ?? 0);
  return {
    ...current,
    ...payload,
    score,
    relevance: relevanceLabel(score),
    updatedAt: new Date().toISOString(),
  };
}

function sectionsForAlert(alert) {
  return alert.sections?.length ? alert.sections : sectionIdsForSource(alert.provenance?.sourceId);
}

export function createAlertsRouter({
  optionalAuthMiddleware = optionalAuth,
  adminMiddleware = requireAdmin,
  readDatabaseFn = readDatabase,
  updateDatabaseFn = updateDatabase,
  readTrackedActionsForUserFn,
} = {}) {
  const router = Router();

  router.get('/', optionalAuthMiddleware, async (request, response, next) => {
    try {
      const { search = '', relevance = 'all', status = 'all', kind = 'all', period = 'current' } = request.query;
      const database = await readDatabaseFn();
      const all = await alertsForViewer(database, request.auth, { readTrackedActionsForUserFn });
      const term = search.toLocaleLowerCase('pt-BR').trim();
      const alerts = all
        .filter(isOfficialRelevantAlert)
        .filter((alert) => period === 'all' || isCurrentFeedItem(alert))
        .filter((alert) => !term || [alert.title, alert.summary, alert.theme, alert.agency, ...(alert.taxes || [])]
          .join(' ').toLocaleLowerCase('pt-BR').includes(term))
        .filter((alert) => relevance === 'all' || alert.relevance === relevance)
        .filter((alert) => status === 'all' || alert.status === status)
        .filter((alert) => kind === 'all' || alert.kind === kind)
        .filter((alert) => !request.query.section || sectionsForAlert(alert).includes(request.query.section))
        .sort((a, b) => {
          const dateDifference = (Date.parse(b.publishedAt || b.createdAt || '') || 0)
            - (Date.parse(a.publishedAt || a.createdAt || '') || 0);
          return dateDifference || (b.score - a.score);
        });

      response.json({ items: alerts, total: alerts.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', optionalAuthMiddleware, async (request, response, next) => {
    try {
      const database = await readDatabaseFn();
      const alert = (await alertsForViewer(database, request.auth, { readTrackedActionsForUserFn }))
        .find((item) => item.id === request.params.id);
      if (!alert || alert.provenance?.analysisMode === 'fast-triage') return response.status(404).json({ message: 'Alerta não encontrado.' });
      response.json(alert);
    } catch (error) {
      next(error);
    }
  });

  router.post('/', adminMiddleware, async (request, response, next) => {
    try {
      if (!request.body.title || !request.body.summary || !request.body.agency) {
        return response.status(400).json({ message: 'Título, resumo e órgão/fonte são obrigatórios.' });
      }
      const alert = normalizeAlert({
        ...request.body,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        isDemo: false,
      });
      await updateDatabaseFn((database) => ({ ...database, alerts: [alert, ...database.alerts] }));
      response.status(201).json(alert);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', adminMiddleware, async (request, response, next) => {
    try {
      let updatedAlert;
      await updateDatabaseFn((database) => {
        const index = database.alerts.findIndex((item) => item.id === request.params.id);
        if (index === -1) return database;
        updatedAlert = normalizeAlert(request.body, database.alerts[index]);
        database.alerts[index] = updatedAlert;
        return database;
      });
      if (!updatedAlert) return response.status(404).json({ message: 'Alerta não encontrado.' });
      response.json(updatedAlert);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const alertsRouter = createAlertsRouter();

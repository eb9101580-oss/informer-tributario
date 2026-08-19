import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readDatabase, updateDatabase } from '../services/store.js';
import { calculateScore, relevanceLabel } from '../services/scoring.js';
import { readTrackedActions } from '../services/trackedActions.js';
import { sectionIdsForSource } from '../data/sections.js';
import { isCurrentFeedItem } from '../services/feedWindow.js';

export const alertsRouter = Router();

function isOfficialRelevantAlert(alert) {
  return alert.isDemo === false && alert.score >= 6 && /^https:\/\//i.test(alert.officialUrl || '') && Boolean(alert.provenance?.sourceId);
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

async function allAlerts(database) {
  try {
    const tracked = await readTrackedActions();
    const movementAlerts = tracked.trackers.flatMap((tracker) => tracker.movementAlerts || []);
    return [...database.alerts, ...movementAlerts];
  } catch (error) {
    // O feed continua disponível em ambientes sem persistência de ações configurada.
    if (error.statusCode === 503) return database.alerts;
    throw error;
  }
}

alertsRouter.get('/', async (request, response, next) => {
  try {
    const { search = '', relevance = 'all', status = 'all', kind = 'all', period = 'current' } = request.query;
    const database = await readDatabase();
    const all = await allAlerts(database);
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
      .sort((a, b) => (b.score - a.score) || new Date(b.publishedAt) - new Date(a.publishedAt));

    response.json({ items: alerts, total: alerts.length });
  } catch (error) {
    next(error);
  }
});

alertsRouter.get('/:id', async (request, response, next) => {
  try {
    const database = await readDatabase();
    const alert = (await allAlerts(database)).find((item) => item.id === request.params.id);
    if (!alert) return response.status(404).json({ message: 'Alerta não encontrado.' });
    response.json(alert);
  } catch (error) {
    next(error);
  }
});

alertsRouter.post('/', async (request, response, next) => {
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
    await updateDatabase((database) => ({ ...database, alerts: [alert, ...database.alerts] }));
    response.status(201).json(alert);
  } catch (error) {
    next(error);
  }
});

alertsRouter.patch('/:id', async (request, response, next) => {
  try {
    let updatedAlert;
    await updateDatabase((database) => {
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

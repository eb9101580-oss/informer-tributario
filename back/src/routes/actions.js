import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth, rolesOf } from '../middleware/auth.js';
import { DATAJUD_COURTS } from '../services/datajud.js';
import { notifyActionMovementAlerts } from '../services/emailNotifications.js';
import {
  actionsStatus,
  addTrackedAction,
  readTrackedActionsForUser,
  refreshAllTrackedActions,
  refreshTrackedAction,
  removeTrackedAction,
  updateTrackedAction,
} from '../services/trackedActions.js';

export const actionsRouter = Router();

function cronSecretMatches(request) {
  const provided = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = String(config.actionCronSecret || '');
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function cronOrAuthenticated(request, response, next) {
  if (cronSecretMatches(request)) { request.internalCron = true; return next(); }
  return requireAuth(request, response, next);
}

function actor(request) {
  return { userId: request.auth.user.id, isAdmin: rolesOf(request.auth.user).includes('admin') };
}

// A rotina aceita o segredo diário; sessões comuns atualizam somente seus próprios acompanhamentos.
actionsRouter.post('/refresh-all', cronOrAuthenticated, async (request, response, next) => {
  try {
    const refreshActor = request.internalCron ? { isSystem: true } : actor(request);
    const items = await refreshAllTrackedActions(refreshActor);
    const newMovementAlerts = items.flatMap((item) => item.newMovementAlerts || []);
    // Reprocessar o histórico curto persistido é intencional: o ledger PostgreSQL
    // elimina duplicatas e permite retentar entregas que falharam no ciclo anterior.
    const movementAlerts = items.flatMap((item) => item.movementAlerts || []);
    const notification = await notifyActionMovementAlerts(movementAlerts);
    const summary = {
      total: items.length,
      changed: items.filter((item) => (item.newMovementAlerts || []).length > 0).length,
      newMovements: newMovementAlerts.length,
      emailDeliveries: notification.deliveries,
      emailFailures: notification.failed,
      errors: items.filter((item) => item.lastError).length,
      updatedAt: new Date().toISOString(),
    };
    if (request.internalCron) return response.json(summary);
    const responseItems = items.map(({ newMovementAlerts: _newMovementAlerts, ...item }) => item);
    return response.json({ ...summary, items: responseItems });
  } catch (error) { next(error); }
});

actionsRouter.use(requireAuth);

actionsRouter.get('/status', (_request, response) => {
  response.json({ ...actionsStatus(), courts: DATAJUD_COURTS });
});

actionsRouter.get('/', async (request, response, next) => {
  try {
    const data = await readTrackedActionsForUser(request.auth.user);
    response.json({ items: data.trackers, total: data.trackers.length, ...actionsStatus() });
  } catch (error) { next(error); }
});

actionsRouter.post('/', async (request, response, next) => {
  try {
    const tracker = await addTrackedAction(request.body || {}, request.auth.user.id);
    const refreshed = await refreshTrackedAction(tracker.id, actor(request));
    response.status(201).json({ item: refreshed, message: 'Acompanhamento criado e consultado no DataJud.' });
  } catch (error) { next(error); }
});

actionsRouter.post('/:id/refresh', async (request, response, next) => {
  try { response.json({ item: await refreshTrackedAction(request.params.id, actor(request)) }); } catch (error) { next(error); }
});

actionsRouter.put('/:id', async (request, response, next) => {
  try {
    const tracker = await updateTrackedAction(request.params.id, request.body || {}, actor(request));
    const refreshed = await refreshTrackedAction(tracker.id, actor(request));
    response.json({ item: refreshed, message: 'Acompanhamento atualizado e consultado na fonte oficial.' });
  } catch (error) { next(error); }
});

actionsRouter.delete('/:id', async (request, response, next) => {
  try {
    const removed = await removeTrackedAction(request.params.id, actor(request));
    if (!removed) return response.status(404).json({ message: 'Acompanhamento não encontrado.' });
    response.status(204).end();
  } catch (error) { next(error); }
});

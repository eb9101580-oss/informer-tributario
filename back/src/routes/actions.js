import { Router } from 'express';
import { DATAJUD_COURTS } from '../services/datajud.js';
import {
  actionsStatus,
  addTrackedAction,
  readTrackedActions,
  refreshAllTrackedActions,
  refreshTrackedAction,
  removeTrackedAction,
  updateTrackedAction,
} from '../services/trackedActions.js';

export const actionsRouter = Router();

actionsRouter.get('/status', (_request, response) => {
  response.json({ ...actionsStatus(), courts: DATAJUD_COURTS });
});

actionsRouter.get('/', async (_request, response, next) => {
  try {
    const data = await readTrackedActions();
    response.json({ items: data.trackers, total: data.trackers.length, ...actionsStatus() });
  } catch (error) { next(error); }
});

actionsRouter.post('/', async (request, response, next) => {
  try {
    const tracker = await addTrackedAction(request.body || {});
    const refreshed = await refreshTrackedAction(tracker.id);
    response.status(201).json({ item: refreshed, message: 'Acompanhamento criado e consultado no DataJud.' });
  } catch (error) { next(error); }
});

actionsRouter.post('/refresh-all', async (_request, response, next) => {
  try {
    const items = await refreshAllTrackedActions();
    response.json({ items, total: items.length, updatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

actionsRouter.post('/:id/refresh', async (request, response, next) => {
  try { response.json({ item: await refreshTrackedAction(request.params.id) }); } catch (error) { next(error); }
});

actionsRouter.put('/:id', async (request, response, next) => {
  try {
    const tracker = await updateTrackedAction(request.params.id, request.body || {});
    const refreshed = await refreshTrackedAction(tracker.id);
    response.json({ item: refreshed, message: 'Acompanhamento atualizado e consultado na fonte oficial.' });
  } catch (error) { next(error); }
});

actionsRouter.delete('/:id', async (request, response, next) => {
  try {
    const removed = await removeTrackedAction(request.params.id);
    if (!removed) return response.status(404).json({ message: 'Acompanhamento não encontrado.' });
    response.status(204).end();
  } catch (error) { next(error); }
});

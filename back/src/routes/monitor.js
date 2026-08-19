import { Router } from 'express';
import { getMonitorSnapshot, normalizeMonitorTargetDate, runMonitor } from '../services/monitor.js';
import { readDatabase } from '../services/store.js';
import { publicationDateKey } from '../services/feedWindow.js';

export const monitorRouter = Router();

monitorRouter.get('/status', async (_request, response, next) => {
  try { response.json(await getMonitorSnapshot()); } catch (error) { next(error); }
});

monitorRouter.get('/runs', async (_request, response, next) => {
  try { const data = await readDatabase(); response.json({ items: (data.monitor?.runs || []).slice(0, 20) }); } catch (error) { next(error); }
});

monitorRouter.get('/candidates', async (request, response, next) => {
  try {
    const data = await readDatabase();
    const status = request.query.status;
    const targetDate = request.query.date ? normalizeMonitorTargetDate(request.query.date) : null;
    const filtered = (data.monitor?.candidates || [])
      .filter((item) => !status || item.status === status)
      .filter((item) => !targetDate || item.backfillDate === targetDate || publicationDateKey(item.publishedAt) === targetDate);
    response.json({ items: filtered.slice(0, 100), total: filtered.length });
  } catch (error) { next(error); }
});

monitorRouter.post('/run', async (request, response, next) => {
  try {
    const snapshot = await getMonitorSnapshot();
    if (snapshot.runtime.running) return response.status(409).json({ message: 'Já existe uma varredura em andamento.' });
    const body = request.body || {};
    const targetDate = normalizeMonitorTargetDate(body.targetDate);
    runMonitor({ analyze: body.analyze !== false, trigger: targetDate ? 'manual-date' : 'manual', targetDate }).catch((error) => console.error('Falha na varredura manual:', error));
    response.status(202).json({ message: targetDate ? `Busca de ${targetDate} iniciada.` : 'Varredura iniciada.', accepted: true, targetDate });
  } catch (error) { next(error); }
});

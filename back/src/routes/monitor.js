import { Router } from 'express';
import { getMonitorSnapshot, runMonitor } from '../services/monitor.js';
import { readDatabase } from '../services/store.js';

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
    const filtered = (data.monitor?.candidates || []).filter((item) => !status || item.status === status);
    response.json({ items: filtered.slice(0, 100), total: filtered.length });
  } catch (error) { next(error); }
});

monitorRouter.post('/run', async (request, response, next) => {
  try {
    const snapshot = await getMonitorSnapshot();
    if (snapshot.runtime.running) return response.status(409).json({ message: 'Já existe uma varredura em andamento.' });
    runMonitor({ analyze: request.body.analyze !== false, trigger: 'manual' }).catch((error) => console.error('Falha na varredura manual:', error));
    response.status(202).json({ message: 'Varredura iniciada.', accepted: true });
  } catch (error) { next(error); }
});

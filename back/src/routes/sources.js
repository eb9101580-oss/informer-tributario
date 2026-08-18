import { Router } from 'express';
import { complementarySources, monitoredSources } from '../data/officialSources.js';

export const sourcesRouter = Router();

sourcesRouter.get('/', (_request, response) => {
  response.json({ items: monitoredSources, total: monitoredSources.length, journalistic: complementarySources.length });
});

sourcesRouter.get('/:id', (request, response) => {
  const source = monitoredSources.find((item) => item.id === request.params.id);
  if (!source) return response.status(404).json({ message: 'Fonte monitorada não encontrada.' });
  response.json(source);
});

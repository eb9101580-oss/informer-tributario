import { Router } from 'express';
import { officialSources } from '../data/officialSources.js';

export const sourcesRouter = Router();

sourcesRouter.get('/', (_request, response) => {
  response.json({ items: officialSources, total: officialSources.length });
});

sourcesRouter.get('/:id', (request, response) => {
  const source = officialSources.find((item) => item.id === request.params.id);
  if (!source) return response.status(404).json({ message: 'Fonte oficial não encontrada.' });
  response.json(source);
});

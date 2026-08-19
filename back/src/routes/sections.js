import { Router } from 'express';
import { monitoredSources } from '../data/officialSources.js';
import { getTaxSection, taxSections } from '../data/sections.js';

export const sectionsRouter = Router();

function withSources(section) {
  return { ...section, sources: monitoredSources.filter((source) => section.sourceIds.includes(source.id)) };
}

sectionsRouter.get('/', (_request, response) => {
  response.json({ items: taxSections.map(withSources), total: taxSections.length });
});

sectionsRouter.get('/:id', (request, response) => {
  const section = getTaxSection(request.params.id);
  if (!section) return response.status(404).json({ message: 'Seção tributária não encontrada.' });
  response.json(withSources(section));
});

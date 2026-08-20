import { Router } from 'express';
import { complementarySources, monitoredSources } from '../data/officialSources.js';
import { requireAdmin } from '../middleware/auth.js';
import { databaseConfigured, query } from '../services/db.js';
import { queryActiveCustomSources } from '../services/customSources.js';
import { assertPublicSourceUrl, inferSourceType } from '../services/sourceSafety.js';

export const sourcesRouter = Router();

sourcesRouter.get('/', (_request, response) => {
  response.json({ items: monitoredSources, total: monitoredSources.length, journalistic: complementarySources.length });
});

function customSourceResponse(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    category: row.category,
    sourceType: row.source_type,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

sourcesRouter.get('/approved-custom', async (_request, response, next) => {
  try {
    if (!databaseConfigured()) return response.json({ items: [], total: 0 });
    const items = await queryActiveCustomSources();
    response.json({ items, total: items.length });
  } catch (error) { next(error); }
});

sourcesRouter.get('/custom', requireAdmin, async (_request, response, next) => {
  try {
    const result = await query(`SELECT c.*, u."name" AS submitted_by_name FROM custom_sources c JOIN "user" u ON u."id" = c.submitted_by ORDER BY c.created_at DESC`);
    response.json({ items: result.rows.map(customSourceResponse), total: result.rows.length });
  } catch (error) { next(error); }
});

sourcesRouter.post('/custom', requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body?.name || '').trim().slice(0, 120);
    if (name.length < 2) return response.status(400).json({ message: 'Informe o nome da fonte.' });
    const url = await assertPublicSourceUrl(request.body?.url);
    const requestedType = ['official', 'journalistic', 'technical'].includes(request.body?.sourceType) ? request.body.sourceType : null;
    const sourceType = requestedType || inferSourceType(url);
    const result = await query(
      `INSERT INTO custom_sources (submitted_by, name, url, category, source_type, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING *`,
      [request.auth.user.id, name, url, String(request.body?.category || 'Fonte personalizada').slice(0, 120), sourceType],
    );
    response.status(201).json(customSourceResponse(result.rows[0]));
  } catch (error) { next(error); }
});

sourcesRouter.patch('/custom/:id', requireAdmin, async (request, response, next) => {
  try {
    const aliases = { approved: 'active' };
    const status = aliases[request.body?.status] || request.body?.status;
    if (!['pending', 'active', 'paused', 'rejected'].includes(status)) return response.status(400).json({ message: 'Status de fonte inválido.' });
    const result = await query(
      `UPDATE custom_sources SET status = $2, approved_by = CASE WHEN $2 = 'active' THEN $3 ELSE approved_by END,
       approved_at = CASE WHEN $2 = 'active' THEN NOW() ELSE approved_at END, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [request.params.id, status, request.auth.user.id],
    );
    if (!result.rows[0]) return response.status(404).json({ message: 'Fonte personalizada não encontrada.' });
    response.json(customSourceResponse(result.rows[0]));
  } catch (error) { next(error); }
});

sourcesRouter.get('/:id', (request, response) => {
  const source = monitoredSources.find((item) => item.id === request.params.id);
  if (!source) return response.status(404).json({ message: 'Fonte monitorada não encontrada.' });
  response.json(source);
});

import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { query, transaction } from '../services/db.js';
import { assertPublicSourceUrl, inferSourceType } from '../services/sourceSafety.js';

function clean(value, maximum) {
  return String(value || '').trim().slice(0, maximum);
}

function suggestionResponse(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    kind: row.kind === 'source' ? 'source' : 'suggestion',
    title: row.title,
    message: row.message,
    url: row.url,
    status: row.status,
    adminResponse: row.admin_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_SUGGESTIONS = `SELECT s.*, u."name" AS user_name, u."email" AS user_email
  FROM user_suggestions s JOIN "user" u ON u."id" = s.user_id`;

export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth);

suggestionsRouter.get('/', async (request, response, next) => {
  try {
    const result = await query(`${SELECT_SUGGESTIONS} WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 100`, [request.auth.user.id]);
    response.json({ items: result.rows.map(suggestionResponse), total: result.rows.length });
  } catch (error) { next(error); }
});

suggestionsRouter.post('/', async (request, response, next) => {
  try {
    const kind = request.body?.kind === 'source' ? 'source' : 'feedback';
    const title = clean(request.body?.title, 120);
    const message = clean(request.body?.message, 2000);
    if (title.length < 3 || message.length < 10) return response.status(400).json({ message: 'Informe um título e pelo menos 10 caracteres de detalhes.' });
    const url = kind === 'source' ? await assertPublicSourceUrl(request.body?.url) : null;
    const result = await query(
      `INSERT INTO user_suggestions (user_id, kind, title, message, url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [request.auth.user.id, kind, title, message, url],
    );
    response.status(201).json(suggestionResponse(result.rows[0]));
  } catch (error) { next(error); }
});

export const adminSuggestionsRouter = Router();
adminSuggestionsRouter.use(requireAdmin);

adminSuggestionsRouter.get('/', async (request, response, next) => {
  try {
    const result = await query(`${SELECT_SUGGESTIONS} ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 300`);
    response.json({ items: result.rows.map(suggestionResponse), total: result.rows.length });
  } catch (error) { next(error); }
});

adminSuggestionsRouter.patch('/:id', async (request, response, next) => {
  try {
    const aliases = { reviewed: 'reviewing' };
    const status = aliases[request.body?.status] || request.body?.status;
    if (!['pending', 'reviewing', 'accepted', 'rejected'].includes(status)) return response.status(400).json({ message: 'Status de sugestão inválido.' });
    const adminResponse = clean(request.body?.adminResponse, 1000) || null;
    const updated = await transaction(async (client) => {
      const current = await client.query('SELECT * FROM user_suggestions WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (!current.rows[0]) return null;
      const item = current.rows[0];
      if (status === 'accepted' && item.kind === 'source') {
        const safeUrl = await assertPublicSourceUrl(item.url);
        const sourceType = inferSourceType(safeUrl);
        await client.query(
          `INSERT INTO custom_sources (submitted_by, name, url, category, source_type, status, approved_by, approved_at)
           VALUES ($1, $2, $3, 'Fonte indicada pela equipe', $4, 'active', $5, NOW())
           ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name, source_type = EXCLUDED.source_type,
             status = 'active', approved_by = EXCLUDED.approved_by, approved_at = NOW(), updated_at = NOW()`,
          [item.user_id, item.title || new URL(safeUrl).hostname, safeUrl, sourceType, request.auth.user.id],
        );
      }
      const result = await client.query(
        `UPDATE user_suggestions SET status = $2, admin_response = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [request.params.id, status, adminResponse, request.auth.user.id],
      );
      return result.rows[0];
    });
    if (!updated) return response.status(404).json({ message: 'Sugestão não encontrada.' });
    response.json(suggestionResponse(updated));
  } catch (error) { next(error); }
});

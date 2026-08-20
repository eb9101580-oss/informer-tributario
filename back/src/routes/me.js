import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, transaction } from '../services/db.js';

const MAX_PUBLICATION_ID = 1_000;
const MAX_SNAPSHOT_BYTES = 100_000;
const MAX_TOPIC_COUNT = 30;

export function normalizePublicationId(value) {
  const publicationId = String(value || '').trim();
  if (!publicationId || publicationId.length > MAX_PUBLICATION_ID || /[\u0000-\u001f]/.test(publicationId)) {
    const error = new Error('Identificador da publicação inválido.');
    error.statusCode = 400;
    throw error;
  }
  return publicationId;
}

export function normalizeReaction(value) {
  if (value === 'like' || value === 1 || value === '1') return 1;
  if (value === 'dislike' || value === -1 || value === '-1') return -1;
  if (value === null || value === 0 || value === '0' || value === 'none') return null;
  const error = new Error('Reação inválida. Use like, dislike ou none.');
  error.statusCode = 400;
  throw error;
}

function cleanText(value, maxLength) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((topic) => cleanText(topic, 80))
    .filter(Boolean)
    .slice(0, MAX_TOPIC_COUNT))];
}

function normalizeMetadata(body) {
  const source = cleanText(body?.source ?? body?.agency, 160);
  const section = cleanText(body?.section ?? body?.theme, 80);
  const topics = normalizeTopics(body?.topics ?? body?.taxes);
  return { source, section, topics };
}

function normalizeSnapshot(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('O retrato da publicação deve ser um objeto.');
    error.statusCode = 400;
    throw error;
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    const error = new Error('O retrato da publicação não é um JSON válido.');
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
    const error = new Error('O retrato da publicação excede 100 KB.');
    error.statusCode = 413;
    throw error;
  }
  return JSON.parse(serialized);
}

function preferenceResponse(row = {}) {
  return {
    emailAlerts: row.email_alerts ?? true,
    actionAlerts: row.action_alerts ?? true,
    minimumScore: Number(row.minimum_score ?? 8),
    digestFrequency: row.digest_frequency || 'instant',
    topicWeights: row.topic_weights || {},
  };
}

function userResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    role: user.role || 'user',
    image: user.image || null,
  };
}

function learnedWeightKeys(row) {
  return [
    ...(row.topics || []).map((topic) => `topic:${String(topic).toLowerCase()}`),
    row.source ? `source:${String(row.source).toLowerCase()}` : null,
    row.section ? `section:${String(row.section).toLowerCase()}` : null,
  ].filter(Boolean);
}

export function calculateTopicWeights(reactions) {
  const weights = {};
  for (const reaction of reactions) {
    for (const key of learnedWeightKeys(reaction)) {
      weights[key] = Math.max(-20, Math.min(20, (weights[key] || 0) + Number(reaction.reaction || 0)));
    }
  }
  return weights;
}

async function ensurePreferences(client, userId) {
  await client.query(
    `INSERT INTO user_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function recomputeTopicWeights(client, userId) {
  const result = await client.query(
    `SELECT reaction, source, section, topics
       FROM publication_reactions
      WHERE user_id = $1`,
    [userId],
  );
  const topicWeights = calculateTopicWeights(result.rows);
  await ensurePreferences(client, userId);
  await client.query(
    `UPDATE user_preferences
        SET topic_weights = $2::jsonb, updated_at = NOW()
      WHERE user_id = $1`,
    [userId, JSON.stringify(topicWeights)],
  );
  return topicWeights;
}

export function createMeRouter({
  authMiddleware = requireAuth,
  queryFn = query,
  transactionFn = transaction,
} = {}) {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (request, response, next) => {
    try {
      const userId = request.auth.user.id;
      const [preferencesResult, reactionsResult, savedResult] = await Promise.all([
        queryFn(
          `SELECT email_alerts, action_alerts, minimum_score, digest_frequency, topic_weights
             FROM user_preferences
            WHERE user_id = $1`,
          [userId],
        ),
        queryFn(
          `SELECT publication_id, reaction, source, section, topics, updated_at
             FROM publication_reactions
            WHERE user_id = $1
            ORDER BY updated_at DESC`,
          [userId],
        ),
        queryFn(
          `SELECT publication_id, snapshot, created_at
             FROM saved_publications
            WHERE user_id = $1
            ORDER BY created_at DESC`,
          [userId],
        ),
      ]);

      return response.json({
        user: userResponse(request.auth.user),
        preferences: preferenceResponse(preferencesResult.rows[0]),
        reactions: reactionsResult.rows.map((row) => ({
          alertId: row.publication_id,
          value: Number(row.reaction),
          agency: row.source,
          theme: row.section,
          taxes: row.topics || [],
          publicationId: row.publication_id,
          reaction: Number(row.reaction) === 1 ? 'like' : 'dislike',
          source: row.source,
          section: row.section,
          topics: row.topics || [],
          updatedAt: row.updated_at,
        })),
        savedPublications: savedResult.rows.map((row) => ({
          publicationId: row.publication_id,
          snapshot: row.snapshot || {},
          savedAt: row.created_at,
        })),
        savedAlertIds: savedResult.rows.map((row) => row.publication_id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reactions', async (request, response, next) => {
    try {
      const userId = request.auth.user.id;
      const publicationId = normalizePublicationId(request.body?.publicationId ?? request.body?.alertId);
      const reaction = normalizeReaction(request.body?.reaction ?? request.body?.value);
      const { source, section, topics } = normalizeMetadata(request.body);

      const topicWeights = await transactionFn(async (client) => {
        if (reaction === null) {
          await client.query(
            'DELETE FROM publication_reactions WHERE user_id = $1 AND publication_id = $2',
            [userId, publicationId],
          );
        } else {
          await client.query(
            `INSERT INTO publication_reactions
               (user_id, publication_id, reaction, source, section, topics, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, NOW(), NOW())
             ON CONFLICT (user_id, publication_id) DO UPDATE
               SET reaction = EXCLUDED.reaction,
                   source = EXCLUDED.source,
                   section = EXCLUDED.section,
                   topics = EXCLUDED.topics,
                   updated_at = NOW()`,
            [userId, publicationId, reaction, source, section, topics],
          );
        }
        return recomputeTopicWeights(client, userId);
      });

      return response.json({
        alertId: publicationId,
        value: reaction,
        publicationId,
        reaction: reaction === 1 ? 'like' : reaction === -1 ? 'dislike' : null,
        topicWeights,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/saved/:alertId', async (request, response, next) => {
    try {
      const userId = request.auth.user.id;
      const publicationId = normalizePublicationId(request.params.alertId);
      const snapshot = normalizeSnapshot(request.body?.publication ?? request.body?.snapshot);
      const result = await queryFn(
        `INSERT INTO saved_publications (user_id, publication_id, snapshot, created_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (user_id, publication_id) DO UPDATE SET snapshot = EXCLUDED.snapshot
         RETURNING publication_id, snapshot, created_at`,
        [userId, publicationId, JSON.stringify(snapshot)],
      );
      return response.status(201).json({
        publicationId: result.rows[0].publication_id,
        snapshot: result.rows[0].snapshot,
        savedAt: result.rows[0].created_at,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/saved/:alertId', async (request, response, next) => {
    try {
      const userId = request.auth.user.id;
      const publicationId = normalizePublicationId(request.params.alertId);
      await queryFn(
        'DELETE FROM saved_publications WHERE user_id = $1 AND publication_id = $2',
        [userId, publicationId],
      );
      return response.json({ publicationId, saved: false });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/preferences', async (request, response, next) => {
    try {
      const body = request.body || {};
      const supplied = ['emailAlerts', 'actionAlerts', 'minimumScore', 'digestFrequency']
        .some((field) => Object.hasOwn(body, field));
      if (!supplied) {
        return response.status(400).json({ message: 'Informe ao menos uma preferência para atualizar.' });
      }

      const emailAlerts = Object.hasOwn(body, 'emailAlerts') ? body.emailAlerts : null;
      const actionAlerts = Object.hasOwn(body, 'actionAlerts') ? body.actionAlerts : null;
      const minimumScore = Object.hasOwn(body, 'minimumScore') ? Number(body.minimumScore) : null;
      const digestFrequency = Object.hasOwn(body, 'digestFrequency') ? String(body.digestFrequency) : null;

      if (emailAlerts !== null && typeof emailAlerts !== 'boolean') {
        return response.status(400).json({ message: 'emailAlerts deve ser verdadeiro ou falso.' });
      }
      if (actionAlerts !== null && typeof actionAlerts !== 'boolean') {
        return response.status(400).json({ message: 'actionAlerts deve ser verdadeiro ou falso.' });
      }
      if (minimumScore !== null && (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 10)) {
        return response.status(400).json({ message: 'minimumScore deve ficar entre 0 e 10.' });
      }
      if (digestFrequency !== null && !['instant', 'daily', 'never'].includes(digestFrequency)) {
        return response.status(400).json({ message: 'digestFrequency deve ser instant, daily ou never.' });
      }

      const result = await queryFn(
        `INSERT INTO user_preferences
           (user_id, email_alerts, action_alerts, minimum_score, digest_frequency, created_at, updated_at)
         VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, 8.0), COALESCE($5, 'instant'), NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           email_alerts = COALESCE($2, user_preferences.email_alerts),
           action_alerts = COALESCE($3, user_preferences.action_alerts),
           minimum_score = COALESCE($4, user_preferences.minimum_score),
           digest_frequency = COALESCE($5, user_preferences.digest_frequency),
           updated_at = NOW()
         RETURNING email_alerts, action_alerts, minimum_score, digest_frequency, topic_weights`,
        [request.auth.user.id, emailAlerts, actionAlerts, minimumScore, digestFrequency],
      );
      return response.json({ preferences: preferenceResponse(result.rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const meRouter = createMeRouter();

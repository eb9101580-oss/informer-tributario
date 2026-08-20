import { Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { requireAdmin } from '../middleware/auth.js';
import { auth, getFrontendUrl, normalizeEmail, validEmail } from '../services/auth.js';
import { query, transaction } from '../services/db.js';

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function nameFromEmail(email) {
  const localPart = email.split('@')[0] || 'Usuário';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() || ''}${word.slice(1)}`)
    .join(' ') || 'Usuário';
}

export function createAdminUsersRouter({
  adminMiddleware = requireAdmin,
  authApi = auth.api,
  queryFn = query,
  transactionFn = transaction,
} = {}) {
  const router = Router();
  router.use(adminMiddleware);

  router.get('/', async (request, response, next) => {
    try {
      const limit = boundedInteger(request.query.limit, 50, 100);
      const offset = boundedInteger(request.query.offset, 0, 100_000);
      const search = String(request.query.search || '').trim().slice(0, 120);
      const values = [];
      const filters = [];
      if (search) {
        values.push(`%${search}%`);
        filters.push(`("name" ILIKE $${values.length} OR "email" ILIKE $${values.length})`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      values.push(limit, offset);

      const [usersResult, totalResult] = await Promise.all([
        queryFn(
          `SELECT "id", "name", "email", "emailVerified", "role", "banned", "banReason", "banExpires", "createdAt", "updatedAt"
             FROM "user"
             ${where}
            ORDER BY "createdAt" DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values,
        ),
        queryFn(
          `SELECT COUNT(*)::INTEGER AS total FROM "user" ${where}`,
          search ? values.slice(0, 1) : [],
        ),
      ]);

      return response.json({
        users: usersResult.rows.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: Boolean(user.emailVerified),
          role: user.role || 'user',
          active: !user.banned,
          banReason: user.banReason || null,
          banExpires: user.banExpires || null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })),
        total: Number(totalResult.rows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/invite', async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      if (!validEmail(email)) {
        return response.status(400).json({ message: 'Informe um e-mail válido.' });
      }
      const name = String(request.body?.name || nameFromEmail(email)).trim().slice(0, 120);
      if (name.length < 2) {
        return response.status(400).json({ message: 'Informe um nome válido.' });
      }

      const existingResult = await queryFn(
        `SELECT "id", "name", "email", "role", "banned"
           FROM "user"
          WHERE "email" = $1`,
        [email],
      );
      let user = existingResult.rows[0];
      let created = false;

      if (user?.banned) {
        return response.status(409).json({ message: 'Este usuário está desativado. Reative-o antes de reenviar o convite.' });
      }

      const headers = fromNodeHeaders(request.headers);
      if (!user) {
        const createdResult = await authApi.createUser({
          body: { email, name, role: 'user' },
          headers,
        });
        user = createdResult.user;
        created = true;
      }

      await queryFn(
        `INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );

      await authApi.signInMagicLink({
        body: {
          email,
          name: user.name || name,
          callbackURL: `${getFrontendUrl()}/app`,
          errorCallbackURL: `${getFrontendUrl()}/login`,
          metadata: { purpose: 'invite' },
        },
        headers,
      });

      return response.status(created ? 201 : 200).json({
        message: created ? 'Usuário criado e convite enviado.' : 'Convite reenviado.',
        user: {
          id: user.id,
          name: user.name || name,
          email: user.email || email,
          role: user.role || 'user',
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:userId', async (request, response, next) => {
    try {
      const userId = String(request.params.userId || '').trim();
      if (!userId || userId.length > 200) {
        return response.status(400).json({ message: 'Usuário inválido.' });
      }
      const body = request.body || {};
      const name = Object.hasOwn(body, 'name') ? String(body.name || '').trim().slice(0, 120) : null;
      const role = Object.hasOwn(body, 'role') ? String(body.role || '').trim().toLowerCase() : null;
      const active = Object.hasOwn(body, 'active') ? body.active : null;

      if (name !== null && name.length < 2) {
        return response.status(400).json({ message: 'Informe um nome válido.' });
      }
      if (role !== null && !['admin', 'user'].includes(role)) {
        return response.status(400).json({ message: 'O papel deve ser admin ou user.' });
      }
      if (active !== null && typeof active !== 'boolean') {
        return response.status(400).json({ message: 'active deve ser verdadeiro ou falso.' });
      }
      if (name === null && role === null && active === null) {
        return response.status(400).json({ message: 'Informe ao menos uma alteração.' });
      }
      if (userId === request.auth.user.id && (active === false || role === 'user')) {
        return response.status(409).json({ message: 'O administrador não pode remover o próprio acesso.' });
      }

      const user = await transactionFn(async (client) => {
        const result = await client.query(
          `UPDATE "user"
              SET "name" = COALESCE($2, "name"),
                  "role" = COALESCE($3, "role"),
                  "banned" = CASE WHEN $4::BOOLEAN IS NULL THEN "banned" ELSE NOT $4 END,
                  "banReason" = CASE WHEN $4::BOOLEAN IS FALSE THEN 'Desativado pelo administrador' WHEN $4::BOOLEAN IS TRUE THEN NULL ELSE "banReason" END,
                  "banExpires" = CASE WHEN $4::BOOLEAN IS TRUE THEN NULL ELSE "banExpires" END,
                  "updatedAt" = NOW()
            WHERE "id" = $1
            RETURNING "id", "name", "email", "emailVerified", "role", "banned", "createdAt", "updatedAt"`,
          [userId, name, role, active],
        );
        if (!result.rows[0]) return null;
        if (active === false) {
          await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
        }
        return result.rows[0];
      });

      if (!user) return response.status(404).json({ message: 'Usuário não encontrado.' });
      return response.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: Boolean(user.emailVerified),
          role: user.role,
          active: !user.banned,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const adminUsersRouter = createAdminUsersRouter();

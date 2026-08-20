import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminUsersRouter } from '../src/routes/users.js';

function administrator(request, _response, next) {
  request.auth = {
    user: { id: 'admin-1', name: 'Admin', email: 'admin@example.test', role: 'admin' },
    session: { id: 'session-admin' },
  };
  next();
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/users', router);
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || error.status || 500).json({ message: error.message });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('admin cria usuário invite-only e envia magic link sem expor token', async () => {
  const authCalls = [];
  const authApi = {
    async createUser({ body }) {
      authCalls.push({ operation: 'create', body });
      return { user: { id: 'user-new', ...body } };
    },
    async signInMagicLink({ body }) {
      authCalls.push({ operation: 'magic-link', body });
      return { status: true };
    },
  };
  const queryFn = async (sql) => {
    if (sql.includes('FROM "user"')) return { rows: [] };
    if (sql.includes('INSERT INTO user_preferences')) return { rows: [] };
    throw new Error(`SQL inesperado: ${sql}`);
  };
  const router = createAdminUsersRouter({ adminMiddleware: administrator, authApi, queryFn });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Nova.Pessoa@Example.test', name: 'Nova Pessoa' }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.user.email, 'nova.pessoa@example.test');
    assert.equal(body.user.role, 'user');
    assert.equal('token' in body, false);
    assert.equal(authCalls[0].body.password, undefined);
    assert.equal(authCalls[1].body.metadata.purpose, 'invite');
    assert.match(authCalls[1].body.callbackURL, /\/app$/);
  });
});

test('admin pode reenviar convite para usuário existente', async () => {
  let createCalls = 0;
  let magicLinkCalls = 0;
  const authApi = {
    async createUser() { createCalls += 1; },
    async signInMagicLink() { magicLinkCalls += 1; },
  };
  const queryFn = async (sql) => {
    if (sql.includes('FROM "user"')) {
      return { rows: [{ id: 'user-2', name: 'Existente', email: 'existe@example.test', role: 'user', banned: false }] };
    }
    return { rows: [] };
  };
  const router = createAdminUsersRouter({ adminMiddleware: administrator, authApi, queryFn });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existe@example.test' }),
    });
    assert.equal(response.status, 200);
    assert.equal(createCalls, 0);
    assert.equal(magicLinkCalls, 1);
  });
});

test('recusa convite com e-mail inválido antes de acessar banco', async () => {
  const router = createAdminUsersRouter({
    adminMiddleware: administrator,
    authApi: {},
    queryFn: async () => { throw new Error('não deveria consultar'); },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inválido' }),
    });
    assert.equal(response.status, 400);
  });
});

test('admin desativa outro usuário e revoga suas sessões', async () => {
  const statements = [];
  const transactionFn = async (work) => work({
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('UPDATE "user"')) {
        return { rows: [{ id: 'user-3', name: 'Pessoa', email: 'pessoa@example.test', emailVerified: true, role: 'user', banned: true }] };
      }
      return { rows: [] };
    },
  });
  const router = createAdminUsersRouter({
    adminMiddleware: administrator,
    authApi: {},
    queryFn: async () => ({ rows: [] }),
    transactionFn,
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/user-3`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.active, false);
    assert.ok(statements.some((statement) => statement.sql.includes('DELETE FROM "session"')));
  });
});

test('admin não pode desativar a própria conta', async () => {
  const router = createAdminUsersRouter({
    adminMiddleware: administrator,
    authApi: {},
    queryFn: async () => ({ rows: [] }),
    transactionFn: async () => { throw new Error('não deveria alterar'); },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/admin-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(response.status, 409);
  });
});

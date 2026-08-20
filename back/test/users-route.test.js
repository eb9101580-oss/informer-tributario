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

test('admin cria conta com e-mail e senha sem enviar mensagem de autenticação', async () => {
  const authCalls = [];
  const authApi = {
    async createUser({ body }) {
      authCalls.push(body);
      return { user: { id: 'user-new', ...body } };
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
      body: JSON.stringify({ email: 'Nova.Pessoa@Example.test', name: 'Nova Pessoa', password: 'SenhaInicial#2026' }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.user.email, 'nova.pessoa@example.test');
    assert.equal(body.user.role, 'user');
    assert.equal(authCalls.length, 1);
    assert.equal(authCalls[0].password, 'SenhaInicial#2026');
  });
});

test('admin não pode duplicar uma conta existente', async () => {
  let createCalls = 0;
  const authApi = { async createUser() { createCalls += 1; } };
  const queryFn = async (sql) => {
    if (sql.includes('FROM "user"')) return { rows: [{ id: 'user-2', email: 'existe@example.test' }] };
    return { rows: [] };
  };
  const router = createAdminUsersRouter({ adminMiddleware: administrator, authApi, queryFn });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existe@example.test', password: 'SenhaInicial#2026' }),
    });
    assert.equal(response.status, 409);
    assert.equal(createCalls, 0);
  });
});

test('recusa conta com senha curta antes de criar o usuário', async () => {
  let createCalls = 0;
  const router = createAdminUsersRouter({
    adminMiddleware: administrator,
    authApi: { async createUser() { createCalls += 1; } },
    queryFn: async () => ({ rows: [] }),
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pessoa@example.test', password: 'curta' }),
    });
    assert.equal(response.status, 400);
    assert.equal(createCalls, 0);
  });
});

test('admin redefine senha e revoga sessões antigas', async () => {
  const authCalls = [];
  const statements = [];
  const queryFn = async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT "id" FROM "user"')) return { rows: [{ id: 'user-3' }] };
    return { rows: [] };
  };
  const router = createAdminUsersRouter({
    adminMiddleware: administrator,
    authApi: { async setUserPassword(input) { authCalls.push(input); } },
    queryFn,
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/user-3/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'NovaSenha#2026' }),
    });
    assert.equal(response.status, 200);
    assert.equal(authCalls[0].body.userId, 'user-3');
    assert.equal(authCalls[0].body.newPassword, 'NovaSenha#2026');
    assert.ok(statements.some((statement) => statement.sql.includes('DELETE FROM "session"')));
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
  const router = createAdminUsersRouter({ adminMiddleware: administrator, authApi: {}, queryFn: async () => ({ rows: [] }), transactionFn });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/user-3`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.active, false);
    assert.ok(statements.some((statement) => statement.sql.includes('DELETE FROM "session"')));
  });
});

test('admin não pode desativar a própria conta', async () => {
  const router = createAdminUsersRouter({
    adminMiddleware: administrator, authApi: {}, queryFn: async () => ({ rows: [] }), transactionFn: async () => { throw new Error('não deveria alterar'); },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/users/admin-1`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
    assert.equal(response.status, 409);
  });
});

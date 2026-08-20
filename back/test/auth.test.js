import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auth,
  normalizeEmail,
  validEmail,
  getTrustedOrigins,
} from '../src/services/auth.js';
import {
  rolesOf,
  userHasRole,
  createOptionalAuth,
  createRequireAuth,
} from '../src/middleware/auth.js';
import { APP_SCHEMA_SQL } from '../src/services/db.js';

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('configura Better Auth com magic link e administração', () => {
  assert.equal(typeof auth.api.signInMagicLink, 'function');
  assert.equal(typeof auth.api.getSession, 'function');
  assert.equal(typeof auth.api.createUser, 'function');
  assert.equal(typeof auth.api.listUsers, 'function');
  assert.ok(getTrustedOrigins().length >= 1);
  assert.ok(getTrustedOrigins().every((origin) => /^https?:\/\//.test(origin)));
});

test('normaliza e valida e-mails sem aceitar formatos incompletos', () => {
  assert.equal(normalizeEmail('  Julia@Example.COM '), 'julia@example.com');
  assert.equal(validEmail('julia@example.com'), true);
  assert.equal(validEmail('julia@localhost'), false);
  assert.equal(validEmail('sem-arroba'), false);
});

test('interpreta papéis simples e múltiplos do Better Auth', () => {
  assert.deepEqual(rolesOf({ role: 'user, admin' }), ['user', 'admin']);
  assert.equal(userHasRole({ role: 'user,admin' }, ['admin']), true);
  assert.equal(userHasRole({ role: 'user' }, ['admin']), false);
});

test('middleware devolve 401 sem sessão e anexa sessão válida', async () => {
  const missing = createRequireAuth({ getSession: async () => null });
  const missingResponse = mockResponse();
  let missingNext = false;
  await missing({ headers: {} }, missingResponse, () => { missingNext = true; });
  assert.equal(missingResponse.statusCode, 401);
  assert.equal(missingResponse.body.code, 'AUTH_REQUIRED');
  assert.equal(missingNext, false);

  const session = { user: { id: 'u1', role: 'user' }, session: { id: 's1' } };
  const accepted = createRequireAuth({ getSession: async () => session });
  const request = { headers: {} };
  let acceptedNext = false;
  await accepted(request, mockResponse(), () => { acceptedNext = true; });
  assert.equal(acceptedNext, true);
  assert.equal(request.auth, session);
});

test('autenticação opcional segue como visitante quando DATABASE_URL não está configurada', async () => {
  let sessionLookups = 0;
  const middleware = createOptionalAuth({
    isAuthConfigured: () => false,
    getSession: async () => {
      sessionLookups += 1;
      throw new Error('não deveria consultar sessão');
    },
  });
  const request = { headers: {} };
  let nextCalled = false;

  await middleware(request, mockResponse(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(sessionLookups, 0);
  assert.equal(request.auth, null);
});

test('schema contempla autenticação, personalização e acompanhamento', () => {
  for (const table of [
    '"user"',
    '"session"',
    'publication_reactions',
    'saved_publications',
    'user_suggestions',
    'custom_sources',
    'tracked_action_followers',
    'notification_deliveries',
  ]) {
    assert.match(APP_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replaceAll('"', '\\"')}`));
  }
});

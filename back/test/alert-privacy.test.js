import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAlertsRouter } from '../src/routes/alerts.js';
import { createDashboardRouter } from '../src/routes/dashboard.js';
import { createFeedbackRouter } from '../src/routes/feedback.js';

function alert(id, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id,
    title: `Alerta ${id}`,
    summary: `Resumo ${id}`,
    theme: 'Tributário',
    agency: 'Fonte oficial',
    taxes: ['ICMS'],
    status: 'Publicado',
    kind: 'Notícia',
    impactType: 'Informativo',
    score: 7,
    relevance: 'Relevante',
    officialUrl: `https://example.test/${id}`,
    publishedAt: now,
    createdAt: now,
    isDemo: false,
    provenance: { sourceId: `source-${id}` },
    ...overrides,
  };
}

const baseDatabase = {
  meta: { lastUpdatedAt: new Date().toISOString() },
  alerts: [
    alert('global'),
    alert('fast', { provenance: { sourceId: 'source-fast', analysisMode: 'fast-triage' } }),
    alert('persisted-private', {
      ownerId: 'user-b',
      provenance: { sourceId: 'tracked-action-stj' },
    }),
  ],
  feedback: [],
};

const trackers = [
  { ownerId: 'user-a', movementAlerts: [alert('movement-a', { score: 8.5, impactType: 'Oportunidade' })] },
  { ownerId: 'user-b', movementAlerts: [alert('movement-b', { score: 8.5, impactType: 'Oportunidade' })] },
];

function sessionMiddleware(request, _response, next) {
  const identity = request.headers['x-test-user'];
  if (identity) {
    request.auth = {
      user: { id: identity, role: identity === 'admin' ? 'admin' : 'user' },
      session: { id: `session-${identity}` },
    };
  } else {
    request.auth = null;
  }
  next();
}

function adminMiddleware(request, response, next) {
  if (request.headers['x-test-user'] !== 'admin') {
    return response.status(403).json({ code: 'FORBIDDEN' });
  }
  request.auth = { user: { id: 'admin', role: 'admin' }, session: { id: 'session-admin' } };
  return next();
}

async function trackedForUser(user) {
  return {
    trackers: user.role === 'admin'
      ? trackers
      : trackers.filter((tracker) => tracker.ownerId === user.id),
  };
}

async function withServer(router, callback) {
  const application = express();
  application.use(express.json());
  application.use(router);
  application.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ message: error.message });
  });
  const server = await new Promise((resolve) => {
    const instance = application.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function jsonRequest(baseUrl, path, identity, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(identity ? { 'X-Test-User': identity } : {}),
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json().catch(() => ({})) };
}

test('feed público exclui movimentos, usuário vê apenas os próprios e admin vê todos', async () => {
  const router = createAlertsRouter({
    optionalAuthMiddleware: sessionMiddleware,
    adminMiddleware,
    readDatabaseFn: async () => structuredClone(baseDatabase),
    readTrackedActionsForUserFn: trackedForUser,
  });

  await withServer(router, async (baseUrl) => {
    const anonymous = await jsonRequest(baseUrl, '/?period=all');
    assert.deepEqual(anonymous.body.items.map((item) => item.id), ['global']);

    const user = await jsonRequest(baseUrl, '/?period=all', 'user-a');
    assert.deepEqual(new Set(user.body.items.map((item) => item.id)), new Set(['global', 'movement-a']));
    assert.equal(user.body.items.some((item) => item.id === 'movement-b'), false);

    const forbiddenDetail = await jsonRequest(baseUrl, '/movement-b', 'user-a');
    assert.equal(forbiddenDetail.response.status, 404);

    const provisionalDetail = await jsonRequest(baseUrl, '/fast', 'user-a');
    assert.equal(provisionalDetail.response.status, 404);

    const admin = await jsonRequest(baseUrl, '/?period=all', 'admin');
    assert.deepEqual(
      new Set(admin.body.items.map((item) => item.id)),
      new Set(['global', 'persisted-private', 'movement-a', 'movement-b']),
    );
  });
});

test('dashboard aplica a mesma privacidade dos movimentos', async () => {
  const router = createDashboardRouter({
    optionalAuthMiddleware: sessionMiddleware,
    readDatabaseFn: async () => structuredClone(baseDatabase),
    readTrackedActionsForUserFn: trackedForUser,
  });

  await withServer(router, async (baseUrl) => {
    const anonymous = await jsonRequest(baseUrl, '/');
    assert.equal(anonymous.body.metrics.relevant, 1);
    assert.equal(anonymous.body.metrics.opportunities, 0);

    const user = await jsonRequest(baseUrl, '/', 'user-a');
    assert.equal(user.body.metrics.relevant, 2);
    assert.equal(user.body.metrics.opportunities, 1);
    assert.deepEqual(user.body.opportunities.map((item) => item.id), ['movement-a']);

    const admin = await jsonRequest(baseUrl, '/', 'admin');
    assert.equal(admin.body.metrics.relevant, 4);
    assert.equal(admin.body.metrics.opportunities, 2);
  });
});

test('mutações de alertas e feedback legado exigem administrador', async () => {
  let database = structuredClone(baseDatabase);
  let updates = 0;
  const updateDatabaseFn = async (updater) => {
    updates += 1;
    database = await updater(database);
    return database;
  };
  const alertsRouter = createAlertsRouter({
    optionalAuthMiddleware: sessionMiddleware,
    adminMiddleware,
    readDatabaseFn: async () => database,
    updateDatabaseFn,
    readTrackedActionsForUserFn: trackedForUser,
  });

  await withServer(alertsRouter, async (baseUrl) => {
    const payload = JSON.stringify({ title: 'Novo', summary: 'Resumo', agency: 'Órgão', score: 8 });
    const user = await jsonRequest(baseUrl, '/', 'user-a', { method: 'POST', body: payload });
    assert.equal(user.response.status, 403);
    assert.equal(updates, 0);

    const admin = await jsonRequest(baseUrl, '/', 'admin', { method: 'POST', body: payload });
    assert.equal(admin.response.status, 201);
    assert.equal(updates, 1);
  });

  let feedbackReads = 0;
  const feedbackRouter = createFeedbackRouter({
    adminMiddleware,
    readDatabaseFn: async () => {
      feedbackReads += 1;
      return database;
    },
    updateDatabaseFn,
    readTrackedActionsFn: async () => ({ trackers: [] }),
  });

  await withServer(feedbackRouter, async (baseUrl) => {
    const user = await jsonRequest(baseUrl, '/', 'user-a');
    assert.equal(user.response.status, 403);
    assert.equal(feedbackReads, 0);

    const admin = await jsonRequest(baseUrl, '/', 'admin');
    assert.equal(admin.response.status, 200);
    assert.equal(feedbackReads, 1);
  });
});

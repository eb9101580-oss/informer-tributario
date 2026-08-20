import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  calculateTopicWeights,
  createMeRouter,
  normalizeReaction,
} from '../src/routes/me.js';

function authenticated(request, _response, next) {
  request.auth = {
    user: {
      id: 'user-1',
      name: 'Usuária Teste',
      email: 'user@example.test',
      emailVerified: true,
      role: 'user',
    },
    session: { id: 'session-1' },
  };
  next();
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use('/api/me', router);
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ message: error.message });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('calcula perfil aprendido a partir de gostei e não gostei', () => {
  const weights = calculateTopicWeights([
    { reaction: 1, topics: ['ICMS'], source: 'STJ', section: 'decisoes' },
    { reaction: 1, topics: ['ICMS'], source: 'STF', section: 'decisoes' },
    { reaction: -1, topics: ['PIS'], source: 'STJ', section: 'noticias' },
  ]);
  assert.equal(weights['topic:icms'], 2);
  assert.equal(weights['topic:pis'], -1);
  assert.equal(weights['source:stj'], 0);
  assert.equal(weights['section:decisoes'], 2);
});

test('normaliza as três operações de reação', () => {
  assert.equal(normalizeReaction('like'), 1);
  assert.equal(normalizeReaction('dislike'), -1);
  assert.equal(normalizeReaction('none'), null);
  assert.throws(() => normalizeReaction('talvez'), /Reação inválida/);
});

test('GET /api/me reúne usuário, preferências, reações e salvos', async () => {
  const queryFn = async (sql) => {
    if (sql.includes('FROM user_preferences')) {
      return { rows: [{ email_alerts: true, action_alerts: true, minimum_score: '8.5', digest_frequency: 'instant', topic_weights: { 'topic:icms': 2 } }] };
    }
    if (sql.includes('FROM publication_reactions')) {
      return { rows: [{ publication_id: 'alert-1', reaction: 1, source: 'STJ', section: 'decisoes', topics: ['ICMS'], updated_at: '2026-08-20T10:00:00Z' }] };
    }
    if (sql.includes('FROM saved_publications')) {
      return { rows: [{ publication_id: 'alert-2', snapshot: { title: 'Notícia' }, created_at: '2026-08-20T11:00:00Z' }] };
    }
    throw new Error(`SQL inesperado: ${sql}`);
  };
  const router = createMeRouter({ authMiddleware: authenticated, queryFn });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.role, 'user');
    assert.equal(body.preferences.minimumScore, 8.5);
    assert.equal(body.reactions[0].reaction, 'like');
    assert.equal(body.reactions[0].alertId, 'alert-1');
    assert.equal(body.reactions[0].value, 1);
    assert.equal(body.savedPublications[0].snapshot.title, 'Notícia');
    assert.deepEqual(body.savedAlertIds, ['alert-2']);
  });
});

test('POST /api/me/reactions persiste e atualiza o perfil aprendido', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('SELECT reaction, source, section, topics')) {
        return { rows: [{ reaction: 1, source: 'STJ', section: 'decisoes', topics: ['ICMS'] }] };
      }
      return { rows: [] };
    },
  };
  const router = createMeRouter({
    authMiddleware: authenticated,
    queryFn: async () => ({ rows: [] }),
    transactionFn: async (work) => work(client),
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId: 'alert-1', value: 1, agency: 'STJ', theme: 'decisoes', taxes: ['ICMS'] }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reaction, 'like');
    assert.equal(body.topicWeights['topic:icms'], 1);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO publication_reactions')));
    assert.ok(calls.some((call) => call.sql.includes('UPDATE user_preferences')));
  });
});

test('salva publicação e valida preferências', async () => {
  const queryFn = async (sql, values) => {
    if (sql.includes('INSERT INTO saved_publications')) {
      return { rows: [{ publication_id: values[1], snapshot: JSON.parse(values[2]), created_at: '2026-08-20T12:00:00Z' }] };
    }
    return { rows: [] };
  };
  const router = createMeRouter({ authMiddleware: authenticated, queryFn });

  await withServer(router, async (baseUrl) => {
    const savedResponse = await fetch(`${baseUrl}/api/me/saved/alert-9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publication: { title: 'Tema tributário' } }),
    });
    const saved = await savedResponse.json();
    assert.equal(savedResponse.status, 201);
    assert.equal(saved.snapshot.title, 'Tema tributário');

    const preferencesResponse = await fetch(`${baseUrl}/api/me/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minimumScore: 11 }),
    });
    assert.equal(preferencesResponse.status, 400);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverWithLedger, notifyActionMovementAlerts, notifyAlerts } from '../src/services/emailNotifications.js';

function movementAlert(overrides = {}) {
  return {
    id: 'action-tracker-1-movement-1',
    ownerId: 'user-1',
    title: 'Tema ICMS: julgamento iniciado',
    summary: 'Uma nova movimentação foi identificada.',
    whatChanged: 'Julgamento iniciado.',
    score: 8.5,
    relevance: 'Alta relevância',
    kind: 'Movimentação processual',
    officialUrl: 'https://tribunal.example/processo/1',
    isDemo: false,
    createdAt: '2026-08-20T12:00:00Z',
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    email_verified: true,
    banned: false,
    email_alerts: true,
    action_alerts: true,
    minimum_score: 8,
    digest_frequency: 'instant',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

test('movimentação com ownerId é enviada somente ao proprietário', async () => {
  const sql = [];
  const sent = [];
  const queryFn = async (text, values = []) => {
    sql.push({ text, values });
    if (text.includes('FROM "user"')) return { rows: [account()] };
    if (text.includes('INSERT INTO notification_deliveries')) return { rows: [{ id: 'delivery-1' }] };
    if (text.includes("SET status = 'sent'")) return { rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };

  const result = await notifyActionMovementAlerts([movementAlert()], {
    ensureSchemaFn: async () => {},
    queryFn,
    sendEmailFn: async (message) => { sent.push(message); return { id: 'resend-1' }; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
  });

  const recipientQuery = sql.find((entry) => entry.text.includes('FROM "user"'));
  assert.deepEqual(recipientQuery.values, ['user-1']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'user@example.com');
  assert.equal(result.deliveries, 1);
});

test('e-mail remove a classificação administrativa Tipo A ou B do título principal', async () => {
  const sent = [];
  const queryFn = async (text) => {
    if (text.includes('FROM "user"')) return { rows: [account()] };
    if (text.includes('INSERT INTO notification_deliveries')) return { rows: [{ id: 'delivery-title' }] };
    if (text.includes("SET status = 'sent'")) return { rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };

  await notifyActionMovementAlerts([movementAlert({ title: 'Sentença Tipo B · 5000000-00.2026.4.01.0000 · Vara Federal' })], {
    ensureSchemaFn: async () => {},
    queryFn,
    sendEmailFn: async (message) => { sent.push(message); return { id: 'resend-title' }; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
  });

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].subject, /Tipo B/i);
  assert.match(sent[0].subject, /Sentença · 5000000/);
  assert.doesNotMatch(sent[0].text, /Tipo B/i);
});

test('ação legada sem ownerId consulta somente administradores', async () => {
  const sql = [];
  const sent = [];
  const queryFn = async (text) => {
    sql.push(text);
    if (text.includes('FROM "user"')) return { rows: [account({ id: 'admin-1', email: 'admin@example.com' })] };
    if (text.includes('INSERT INTO notification_deliveries')) return { rows: [{ id: 'delivery-legacy' }] };
    if (text.includes("SET status = 'sent'")) return { rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };

  await notifyActionMovementAlerts([movementAlert({ ownerId: null })], {
    ensureSchemaFn: async () => {},
    queryFn,
    sendEmailFn: async (message) => { sent.push(message); return { id: 'resend-legacy' }; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
  });

  assert.match(sql.find((text) => text.includes('FROM "user"')), /admin/);
  assert.deepEqual(sent.map((item) => item.to), ['admin@example.com']);
});

test('owner inexistente não cai na lista legada ou em administradores', async () => {
  const selects = [];
  let sends = 0;
  const result = await notifyActionMovementAlerts([movementAlert({ ownerId: 'missing-user' })], {
    ensureSchemaFn: async () => {},
    queryFn: async (text, values = []) => {
      if (text.includes('FROM "user"')) { selects.push({ text, values }); return { rows: [] }; }
      throw new Error('Não deveria reservar entrega sem destinatário.');
    },
    sendEmailFn: async () => { sends += 1; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
  });
  assert.equal(selects.length, 1);
  assert.deepEqual(selects[0].values, ['missing-user']);
  assert.equal(sends, 0);
  assert.equal(result.noRecipients, 1);
});

test('ledger não reenvia evento já reservado ou enviado', async () => {
  let sends = 0;
  const result = await deliverWithLedger({
    account: account(),
    eventType: 'action-movement',
    eventKey: 'movement-1',
    message: { subject: 'Teste', html: '<p>Teste</p>', text: 'Teste' },
  }, {
    queryFn: async () => ({ rows: [] }),
    sendEmailFn: async () => { sends += 1; },
  });
  assert.equal(result.status, 'duplicate');
  assert.equal(sends, 0);
});

test('publicação respeita nota mínima individual e mantém assinantes legados', async () => {
  const sent = [];
  const marked = [];
  const alert = movementAlert({
    id: 'publication-1', ownerId: undefined, kind: 'Norma tributária', score: 8.4,
  });
  const queryFn = async (text) => {
    if (text.includes('FROM "user"')) return { rows: [
      account({ id: 'user-8', email: 'account@example.com', minimum_score: 8 }),
      account({ id: 'user-9', email: 'strict@example.com', minimum_score: 9 }),
    ] };
    if (text.includes('INSERT INTO notification_deliveries')) return { rows: [{ id: `delivery-${sent.length}` }] };
    if (text.includes("SET status = 'sent'")) return { rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };

  const result = await notifyAlerts([alert], {
    requireCurrentFeed: false,
    ensureSchemaFn: async () => {},
    queryFn,
    sendEmailFn: async (message) => { sent.push(message); return { id: `resend-${sent.length}` }; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
    readSubscriptionsFn: async () => ({
      notifiedAlertIds: [],
      subscribers: [
        { id: 'legacy-duplicate', email: 'account@example.com', active: true, createdAt: '2026-08-01T00:00:00Z' },
        { id: 'legacy-only', email: 'legacy@example.com', active: true, createdAt: '2026-08-01T00:00:00Z' },
      ],
    }),
    markAlertsNotifiedFn: async (ids) => { marked.push(...ids); },
  });

  assert.deepEqual(sent.map((item) => item.to).sort(), ['account@example.com', 'legacy@example.com']);
  assert.deepEqual(marked, ['publication-1']);
  assert.equal(result.deliveries, 2);
  assert.equal(result.alertsSent, 1);
});

test('agrupa várias publicações nota alta em um único e-mail por conta', async () => {
  const sent = [];
  let claims = 0;
  const alerts = [
    movementAlert({ id: 'publication-a', ownerId: undefined, kind: 'Norma tributária', score: 8.2, title: 'Publicação A' }),
    movementAlert({ id: 'publication-b', ownerId: undefined, kind: 'Decisão tributária', score: 9.1, title: 'Publicação B' }),
  ];
  const queryFn = async (text) => {
    if (text.includes('FROM "user"')) return { rows: [account()] };
    if (text.includes('INSERT INTO notification_deliveries')) {
      claims += 1;
      return { rows: [{ id: `00000000-0000-4000-8000-${String(claims).padStart(12, '0')}` }] };
    }
    if (text.includes("SET status = 'sent'")) return { rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };

  const result = await notifyAlerts(alerts, {
    requireCurrentFeed: false,
    ensureSchemaFn: async () => {},
    queryFn,
    sendEmailFn: async (message) => { sent.push(message); return { id: 'resend-digest' }; },
    emailIsConfigured: () => true,
    databaseIsConfigured: () => true,
    readSubscriptionsFn: async () => ({ notifiedAlertIds: [], subscribers: [] }),
    markAlertsNotifiedFn: async () => {},
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /2 novas publicações/);
  assert.match(sent[0].text, /Publicação A/);
  assert.match(sent[0].text, /Publicação B/);
  assert.equal(result.alertsSent, 2);
  assert.equal(result.deliveries, 1);
});

test('não envia publicação sobre Simples Nacional', async () => {
  let sends = 0;
  const alert = movementAlert({
    id: 'publication-simples',
    ownerId: undefined,
    kind: 'Norma tributária',
    score: 9.4,
    title: 'Receita publica orientação sobre o Simples Nacional',
  });

  const result = await notifyAlerts([alert], {
    requireCurrentFeed: false,
    emailIsConfigured: () => true,
    databaseIsConfigured: () => false,
    readSubscriptionsFn: async () => ({
      notifiedAlertIds: [],
      subscribers: [{ id: 'legacy', email: 'legacy@example.com', active: true }],
    }),
    sendEmailFn: async () => { sends += 1; },
    markAlertsNotifiedFn: async () => {},
  });

  assert.equal(sends, 0);
  assert.equal(result.alertsSent, 0);
  assert.equal(result.deliveries, 0);
});

import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { databaseConfigured, ensureAppSchema, query } from './db.js';
import { emailConfigured, sendEmail } from './email.js';
import { isCurrentFeedItem } from './feedWindow.js';
import { isExcludedTaxTopic } from './sourceAdapters.js';
import { alertPassesTaxIntelligencePolicy, primarySourceUrlForAlert } from './taxIntelligencePolicy.js';
import { markAlertsNotified, readSubscriptions } from './subscriptions.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DELIVERY_STALE_MINUTES = 20;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function displayAlertTitle(value = '') {
  return String(value || '')
    .replace(/^\s*(senten[cç]a)\s+tipo\s+[a-z0-9]+\s*(?:[·—-]\s*)?/i, '$1 · ')
    .trim();
}

function displayPublicationDate(value) {
  const raw = String(value || '').trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 'Não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed);
}

function displayList(value, fallback = 'Não informado') {
  const items = (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)].join(' · ') : fallback;
}

function editorialPriority(alert) {
  if (['Alta', 'Média', 'Acompanhamento'].includes(alert.priority)) return alert.priority;
  if (alert.status === 'Em andamento' || alert.kind === 'Movimentação processual') return 'Acompanhamento';
  return Number(alert.score) >= 8 ? 'Alta' : 'Média';
}

function publicationFields(alert) {
  return {
    title: displayAlertTitle(alert.title),
    score: String(alert.score).replace('.', ','),
    relevance: String(alert.relevance || 'Alta relevância'),
    priority: editorialPriority(alert),
    publishedAt: displayPublicationDate(alert.publishedAt),
    agency: String(alert.agency || alert.provenance?.sourceName || 'Não informado'),
    taxes: displayList(alert.taxes),
    summary: String(alert.summary || 'Não informado'),
    whatChanged: String(alert.whatChanged || 'Não informado'),
    practicalImpact: String(alert.practicalImpact || 'Não informado'),
    impactType: String(alert.impactType || 'Acompanhamento'),
    impactDetail: String(alert.officeAction || alert.opportunity?.action || 'Acompanhar a fonte oficial.'),
    affectedProfiles: displayList(alert.affectedProfiles),
    legalBasis: displayList(alert.legalBasis, 'Não identificada no documento'),
    primarySourceUrl: primarySourceUrlForAlert(alert) || '',
  };
}

function fullPublicationHtml(alert, headingLevel = 2) {
  const fields = publicationFields(alert);
  const Heading = `h${headingLevel}`;
  const source = fields.primarySourceUrl
    ? `<p><a href="${escapeHtml(fields.primarySourceUrl)}">Abrir fonte oficial primária</a></p>`
    : '<p><strong>Fonte oficial primária:</strong> não localizada.</p>';
  return `<${Heading} style="font-size:18px;margin:0 0 6px">${escapeHtml(fields.title)}</${Heading}>
    <p style="margin:0 0 8px"><strong>Nota ${fields.score}/10</strong> · ${escapeHtml(fields.relevance)} · <strong>Prioridade ${escapeHtml(fields.priority)}</strong></p>
    <p><strong>Data:</strong> ${escapeHtml(fields.publishedAt)}<br><strong>Órgão:</strong> ${escapeHtml(fields.agency)}<br><strong>Tributos:</strong> ${escapeHtml(fields.taxes)}</p>
    <h3>O que aconteceu</h3><p>${escapeHtml(fields.summary)}</p>
    <h3>O que mudou</h3><p>${escapeHtml(fields.whatChanged)}</p>
    <h3>Impacto prático</h3><p>${escapeHtml(fields.practicalImpact)}</p>
    <h3>Oportunidade ou risco</h3><p><strong>${escapeHtml(fields.impactType)}</strong> — ${escapeHtml(fields.impactDetail)}</p>
    <h3>Quem pode ser afetado</h3><p>${escapeHtml(fields.affectedProfiles)}</p>
    <h3>Base jurídica</h3><p>${escapeHtml(fields.legalBasis)}</p>
    ${source}`;
}

function fullPublicationText(alert) {
  const fields = publicationFields(alert);
  return `${fields.title}
Nota ${alert.score}/10 · ${fields.relevance} · Prioridade ${fields.priority}
Data: ${fields.publishedAt}
Órgão: ${fields.agency}
Tributos: ${fields.taxes}

O que aconteceu
${fields.summary}

O que mudou
${fields.whatChanged}

Impacto prático
${fields.practicalImpact}

Oportunidade ou risco
${fields.impactType} — ${fields.impactDetail}

Quem pode ser afetado
${fields.affectedProfiles}

Base jurídica
${fields.legalBasis}

Fonte oficial primária: ${fields.primarySourceUrl || 'Não localizada'}`;
}

function deliveryKey(eventType, eventKey, userId) {
  const fingerprint = createHash('sha256').update(`${eventType}:${eventKey}:${userId}`).digest('hex');
  return `informer-${fingerprint}`;
}

function alertEventDate(alert) {
  const value = Date.parse(alert.createdAt || alert.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function accountCreatedDate(account) {
  const value = Date.parse(account.created_at || account.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function activeEmailAccount(account) {
  return EMAIL_PATTERN.test(normalizeEmail(account?.email))
    && account?.banned !== true
    && account?.email_verified !== false
    && account?.email_alerts !== false
    && account?.digest_frequency !== 'never';
}

function accountAcceptsPublication(account, alert) {
  if (!activeEmailAccount(account)) return false;
  const minimumScore = Math.max(config.emailThreshold, Number(account.minimum_score) || config.emailThreshold);
  if (Number(alert.score) < minimumScore) return false;
  const createdAt = accountCreatedDate(account);
  const eventAt = alertEventDate(alert);
  return !createdAt || !eventAt || eventAt >= createdAt;
}

function accountAcceptsAction(account, alert) {
  if (!activeEmailAccount(account) || account?.action_alerts === false) return false;
  const createdAt = accountCreatedDate(account);
  const eventAt = alertEventDate(alert);
  return !createdAt || !eventAt || eventAt >= createdAt;
}

function uniqueAlerts(alerts = []) {
  const seen = new Set();
  return alerts.filter((alert) => {
    const id = String(alert?.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function alertMessage(alert) {
  const displayTitle = displayAlertTitle(alert.title);
  const actionMovement = alert.kind === 'Movimentação processual';
  const subjectPrefix = actionMovement ? '[Informer · Ação]' : '[Informer]';
  return {
    subject: `${subjectPrefix} Nota ${String(alert.score).replace('.', ',')} — ${displayTitle}`.slice(0, 180),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#173c3c;max-width:680px;margin:auto">${fullPublicationHtml(alert)}<p>Você recebeu este aviso pelas preferências de alerta do Informer Tributário.</p></div>`,
    text: fullPublicationText(alert),
  };
}

function publicationDigestMessage(alerts) {
  const ordered = [...alerts].sort((left, right) => Number(right.score) - Number(left.score));
  const itemsHtml = ordered.map((alert) => `<article style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #dfe8e6">
    ${fullPublicationHtml(alert)}
  </article>`).join('');
  const itemsText = ordered.map(fullPublicationText).join('\n\n---\n\n');
  return {
    subject: `[Informer] ${ordered.length} ${ordered.length === 1 ? 'nova publicação' : 'novas publicações'} com nota 8+`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#173c3c;max-width:680px;margin:auto"><h1>Radar tributário</h1><p>Estas são as novas publicações de alta relevância encontradas na última varredura.</p>${itemsHtml}<p>Você recebeu este resumo pelas preferências de alerta do Informer Tributário.</p></div>`,
    text: `Radar tributário — ${ordered.length} nova(s) publicação(ões) com nota 8+\n\n${itemsText}`,
  };
}

async function loadPublicationAccounts(queryFn) {
  const result = await queryFn(
    `SELECT u."id" AS id,
            u."email" AS email,
            u."emailVerified" AS email_verified,
            u."banned" AS banned,
            u."createdAt" AS created_at,
            COALESCE(p.email_alerts, TRUE) AS email_alerts,
            COALESCE(p.action_alerts, TRUE) AS action_alerts,
            COALESCE(p.minimum_score, 8.0) AS minimum_score,
            COALESCE(p.digest_frequency, 'instant') AS digest_frequency
       FROM "user" u
       LEFT JOIN user_preferences p ON p.user_id = u."id"`,
  );
  return result.rows || [];
}

async function loadActionAccounts(ownerId, queryFn) {
  const columns = `SELECT u."id" AS id,
                          u."email" AS email,
                          u."emailVerified" AS email_verified,
                          u."banned" AS banned,
                          u."createdAt" AS created_at,
                          COALESCE(p.email_alerts, TRUE) AS email_alerts,
                          COALESCE(p.action_alerts, TRUE) AS action_alerts,
                          COALESCE(p.minimum_score, 8.0) AS minimum_score,
                          COALESCE(p.digest_frequency, 'instant') AS digest_frequency
                     FROM "user" u
                     LEFT JOIN user_preferences p ON p.user_id = u."id"`;
  if (ownerId) {
    const result = await queryFn(`${columns} WHERE u."id" = $1`, [ownerId]);
    return result.rows || [];
  }
  // Acompanhamentos anteriores ao login não têm ownerId. Eles nunca são enviados
  // à lista legada: somente administradores autenticáveis podem recebê-los.
  const result = await queryFn(
    `${columns}
      WHERE (',' || REPLACE(LOWER(COALESCE(u."role", '')), ' ', '') || ',') LIKE '%,admin,%'`,
  );
  return result.rows || [];
}

/**
 * Reserve one delivery in PostgreSQL before calling the provider. The unique
 * constraint and deterministic Resend key make retries safe across workers.
 */
export async function deliverWithLedger({ account, eventType, eventKey, message }, {
  queryFn = query,
  sendEmailFn = sendEmail,
} = {}) {
  const claim = await queryFn(
    `INSERT INTO notification_deliveries
       (user_id, channel, event_type, event_key, status, attempt_count, last_attempt_at, updated_at, created_at)
     VALUES ($1, 'email', $2, $3, 'pending', 1, NOW(), NOW(), NOW())
     ON CONFLICT (user_id, channel, event_type, event_key) DO UPDATE
       SET status = 'pending',
           error_message = NULL,
           attempt_count = notification_deliveries.attempt_count + 1,
           last_attempt_at = NOW(),
           updated_at = NOW()
     WHERE notification_deliveries.status = 'failed'
        OR (notification_deliveries.status = 'pending'
            AND COALESCE(notification_deliveries.last_attempt_at, notification_deliveries.created_at)
                < NOW() - ($4::INTEGER * INTERVAL '1 minute'))
     RETURNING id`,
    [account.id, eventType, eventKey, DELIVERY_STALE_MINUTES],
  );
  const deliveryId = claim.rows?.[0]?.id;
  if (!deliveryId) return { status: 'duplicate' };

  try {
    const provider = await sendEmailFn({
      to: normalizeEmail(account.email),
      ...message,
      idempotencyKey: deliveryKey(eventType, eventKey, account.id),
    });
    await queryFn(
      `UPDATE notification_deliveries
          SET status = 'sent', provider_id = $2, error_message = NULL, sent_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [deliveryId, provider?.id || null],
    );
    return { status: 'sent' };
  } catch (error) {
    const errorMessage = String(error?.message || 'Falha no provedor de e-mail').slice(0, 1_000);
    try {
      await queryFn(
        `UPDATE notification_deliveries
            SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1`,
        [deliveryId, errorMessage],
      );
    } catch (ledgerError) {
      console.error('Falha ao registrar erro de entrega:', ledgerError.message);
    }
    return { status: 'failed' };
  }
}

async function claimDelivery({ account, eventType, eventKey }, queryFn) {
  const claim = await queryFn(
    `INSERT INTO notification_deliveries
       (user_id, channel, event_type, event_key, status, attempt_count, last_attempt_at, updated_at, created_at)
     VALUES ($1, 'email', $2, $3, 'pending', 1, NOW(), NOW(), NOW())
     ON CONFLICT (user_id, channel, event_type, event_key) DO UPDATE
       SET status = 'pending', error_message = NULL,
           attempt_count = notification_deliveries.attempt_count + 1,
           last_attempt_at = NOW(), updated_at = NOW()
     WHERE notification_deliveries.status = 'failed'
        OR (notification_deliveries.status = 'pending'
            AND COALESCE(notification_deliveries.last_attempt_at, notification_deliveries.created_at)
                < NOW() - ($4::INTEGER * INTERVAL '1 minute'))
     RETURNING id`,
    [account.id, eventType, eventKey, DELIVERY_STALE_MINUTES],
  );
  return claim.rows?.[0]?.id || null;
}

async function notifyPostgresPublications(alerts, {
  ensureSchemaFn,
  queryFn,
  sendEmailFn,
}) {
  await ensureSchemaFn();
  const accounts = await loadPublicationAccounts(queryFn);
  const accountEmails = new Set(accounts.map((account) => normalizeEmail(account.email)).filter(Boolean));
  let deliveries = 0;
  let failed = 0;
  let duplicates = 0;
  const sentAlertIds = new Set();

  for (const account of accounts) {
    const accepted = alerts.filter((alert) => accountAcceptsPublication(account, alert));
    const claimed = [];
    for (const alert of accepted) {
      const deliveryId = await claimDelivery({ account, eventType: 'high-score-publication', eventKey: alert.id }, queryFn);
      if (deliveryId) claimed.push({ alert, deliveryId });
      else duplicates += 1;
    }
    if (!claimed.length) continue;

    try {
      const alertIds = claimed.map((item) => item.alert.id).sort();
      const provider = await sendEmailFn({
        to: normalizeEmail(account.email),
        ...publicationDigestMessage(claimed.map((item) => item.alert)),
        idempotencyKey: deliveryKey('high-score-publication-digest', alertIds.join('|'), account.id),
      });
      await queryFn(
        `UPDATE notification_deliveries
            SET status = 'sent', provider_id = $2, error_message = NULL, sent_at = NOW(), updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [claimed.map((item) => item.deliveryId), provider?.id || null],
      );
      deliveries += 1;
      claimed.forEach((item) => sentAlertIds.add(item.alert.id));
    } catch (error) {
      const errorMessage = String(error?.message || 'Falha no provedor de e-mail').slice(0, 1_000);
      await queryFn(
        `UPDATE notification_deliveries
            SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [claimed.map((item) => item.deliveryId), errorMessage],
      ).catch((ledgerError) => console.error('Falha ao registrar erro do resumo:', ledgerError.message));
      failed += 1;
    }
  }

  return { deliveries, failed, duplicates, sentAlertIds, accountEmails };
}

export async function notifyActionMovementAlerts(alerts, {
  ensureSchemaFn = ensureAppSchema,
  queryFn = query,
  sendEmailFn = sendEmail,
  emailIsConfigured = emailConfigured,
  databaseIsConfigured = databaseConfigured,
} = {}) {
  const candidates = uniqueAlerts(alerts).filter((alert) => alert?.isDemo === false
    && /^https:\/\//i.test(alert.officialUrl || ''));
  if (!candidates.length) return { configured: true, databaseConfigured: databaseIsConfigured(), events: 0, deliveries: 0, failed: 0, duplicates: 0, noRecipients: 0 };
  if (!emailIsConfigured()) return { configured: false, databaseConfigured: databaseIsConfigured(), events: candidates.length, deliveries: 0, failed: 0, duplicates: 0, noRecipients: candidates.length };
  if (!databaseIsConfigured()) return { configured: true, databaseConfigured: false, events: candidates.length, deliveries: 0, failed: 0, duplicates: 0, noRecipients: candidates.length };

  await ensureSchemaFn();
  const recipientCache = new Map();
  let deliveries = 0;
  let failed = 0;
  let duplicates = 0;
  let noRecipients = 0;

  for (const alert of candidates) {
    const ownerId = String(alert.ownerId || '').trim() || null;
    const cacheKey = ownerId ? `owner:${ownerId}` : 'legacy-admins';
    if (!recipientCache.has(cacheKey)) recipientCache.set(cacheKey, await loadActionAccounts(ownerId, queryFn));
    const recipients = recipientCache.get(cacheKey).filter((account) => accountAcceptsAction(account, alert));
    if (!recipients.length) { noRecipients += 1; continue; }
    const message = alertMessage(alert);
    for (const account of recipients) {
      const result = await deliverWithLedger({
        account,
        eventType: 'action-movement',
        eventKey: alert.id,
        message,
      }, { queryFn, sendEmailFn });
      if (result.status === 'sent') deliveries += 1;
      else if (result.status === 'failed') failed += 1;
      else duplicates += 1;
    }
  }

  return {
    configured: true,
    databaseConfigured: true,
    events: candidates.length,
    deliveries,
    failed,
    duplicates,
    noRecipients,
  };
}

export async function notifyAlerts(alerts, {
  requireCurrentFeed = true,
  ensureSchemaFn = ensureAppSchema,
  queryFn = query,
  sendEmailFn = sendEmail,
  emailIsConfigured = emailConfigured,
  databaseIsConfigured = databaseConfigured,
  readSubscriptionsFn = readSubscriptions,
  markAlertsNotifiedFn = markAlertsNotified,
} = {}) {
  if (!emailIsConfigured()) return { configured: false, alertsSent: 0, deliveries: 0, skipped: alerts.length, failed: 0 };
  const eligibleAlerts = uniqueAlerts(alerts)
    .filter((alert) => alert?.isDemo === false && Number(alert.score) >= config.emailThreshold && Boolean(primarySourceUrlForAlert(alert)))
    .filter((alert) => alert.provenance?.analysisMode !== 'fast-triage')
    .filter(alertPassesTaxIntelligencePolicy)
    .filter((alert) => !isExcludedTaxTopic(alert.title, alert.summary, alert.whatChanged, alert.practicalImpact, alert.theme, alert.taxes))
    .filter((alert) => !requireCurrentFeed || isCurrentFeedItem(alert));

  let postgres = { deliveries: 0, failed: 0, duplicates: 0, sentAlertIds: new Set(), accountEmails: new Set() };
  if (databaseIsConfigured()) {
    try {
      postgres = await notifyPostgresPublications(eligibleAlerts, { ensureSchemaFn, queryFn, sendEmailFn });
    } catch (error) {
      // Public alert delivery can still continue for encrypted legacy subscriptions.
      console.error('Falha ao notificar contas PostgreSQL:', error.message);
    }
  }

  let subscriptions;
  try {
    subscriptions = await readSubscriptionsFn();
  } catch (error) {
    console.error('Falha ao ler assinaturas legadas:', error.message);
    return {
      configured: true,
      alertsSent: postgres.sentAlertIds.size,
      deliveries: postgres.deliveries,
      skipped: eligibleAlerts.length - postgres.sentAlertIds.size,
      failed: postgres.failed,
    };
  }

  const notified = new Set(subscriptions.notifiedAlertIds || []);
  const legacyCandidates = eligibleAlerts.filter((alert) => !notified.has(alert.id));
  const sentIds = [];
  let legacyDeliveries = 0;
  let legacyFailures = 0;

  for (const alert of legacyCandidates) {
    const eligibleSubscribers = (subscriptions.subscribers || []).filter((subscriber) => subscriber.active !== false
      && !postgres.accountEmails.has(normalizeEmail(subscriber.email))
      && (!subscriber.createdAt || alertEventDate(alert) >= Date.parse(subscriber.createdAt)));
    if (!eligibleSubscribers.length) {
      sentIds.push(alert.id);
      continue;
    }
    const message = alertMessage(alert);
    let complete = true;
    for (const subscriber of eligibleSubscribers) {
      try {
        await sendEmailFn({
          to: subscriber.email,
          ...message,
          idempotencyKey: deliveryKey('legacy-high-score-publication', alert.id, subscriber.id),
        });
        legacyDeliveries += 1;
      } catch (error) {
        complete = false;
        legacyFailures += 1;
        console.error(`Falha ao enviar ${alert.id}:`, error.message);
      }
    }
    if (complete) sentIds.push(alert.id);
  }

  if (sentIds.length) await markAlertsNotifiedFn(sentIds);
  const allSentAlertIds = new Set([...sentIds, ...postgres.sentAlertIds]);
  return {
    configured: true,
    alertsSent: allSentAlertIds.size,
    deliveries: legacyDeliveries + postgres.deliveries,
    skipped: eligibleAlerts.length - allSentAlertIds.size,
    failed: legacyFailures + postgres.failed,
  };
}

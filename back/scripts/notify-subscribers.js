import { readDatabase } from '../src/services/store.js';
import { config } from '../src/config.js';
import { emailConfigured, sendEmail } from '../src/services/email.js';
import { markAlertsNotified, readSubscriptions } from '../src/services/subscriptions.js';
import { isCurrentFeedItem } from '../src/services/feedWindow.js';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

const database = await readDatabase();
const subscriptions = await readSubscriptions();
if (!emailConfigured()) {
  console.log('Notificações não enviadas: RESEND_API_KEY/ALERTS_FROM_EMAIL não configurados.');
  process.exit(0);
}
if (!subscriptions.subscribers.length) {
  console.log('Notificações não enviadas: nenhum e-mail cadastrado.');
  process.exit(0);
}

const notified = new Set(subscriptions.notifiedAlertIds);
const candidates = database.alerts
  .filter((alert) => alert.isDemo === false && alert.score >= config.emailThreshold && /^https:\/\//i.test(alert.officialUrl || ''))
  .filter(isCurrentFeedItem)
  .filter((alert) => !notified.has(alert.id));
const sentIds = [];

for (const alert of candidates) {
  const eligibleSubscribers = subscriptions.subscribers.filter((subscriber) => subscriber.active !== false
    && (!subscriber.createdAt || new Date(alert.createdAt || alert.publishedAt) >= new Date(subscriber.createdAt)));
  if (!eligibleSubscribers.length) {
    sentIds.push(alert.id);
    continue;
  }
  const title = escapeHtml(alert.title);
  const summary = escapeHtml(alert.summary);
  const changed = escapeHtml(alert.whatChanged);
  const link = escapeHtml(alert.officialUrl);
  const subject = `[Informer] Nota ${String(alert.score).replace('.', ',')} — ${alert.title}`.slice(0, 180);
  const html = `<h2>${title}</h2><p><strong>Nota ${String(alert.score).replace('.', ',')}/10</strong> · ${escapeHtml(alert.relevance)}</p><p>${summary}</p><h3>O que mudou</h3><p>${changed}</p><p><a href="${link}">Abrir publicação original</a></p><p>Você recebeu este aviso porque se cadastrou no Informer Tributário para notas a partir de ${config.emailThreshold}.</p>`;
  const text = `${alert.title}\nNota ${alert.score}/10\n\n${alert.summary}\n\nO que mudou\n${alert.whatChanged}\n\nFonte: ${alert.officialUrl}`;
  try {
    for (const subscriber of eligibleSubscribers) {
      await sendEmail({ to: subscriber.email, subject, html, text, idempotencyKey: `alert-${alert.id}-${subscriber.id}` });
    }
    sentIds.push(alert.id);
    console.log(`Alerta ${alert.id} enviado para ${eligibleSubscribers.length} cadastro(s).`);
  } catch (error) {
    console.error(`Falha ao enviar ${alert.id}:`, error.message);
  }
}

if (sentIds.length) await markAlertsNotified(sentIds);
console.log(`Processamento de notificações concluído: ${sentIds.length} alerta(s).`);

import { config } from '../config.js';

export function emailConfigured() {
  return Boolean(config.resendApiKey && config.emailFrom);
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!emailConfigured()) {
    const error = new Error('O envio de e-mail requer RESEND_API_KEY e ALERTS_FROM_EMAIL.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend respondeu com status ${response.status}: ${details.slice(0, 300)}`);
  }
  return response.json();
}

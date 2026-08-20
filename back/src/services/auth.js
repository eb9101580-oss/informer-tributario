import 'dotenv/config';
import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { admin, magicLink } from 'better-auth/plugins';
import { toNodeHandler } from 'better-auth/node';
import { getPool, ensureAppSchema, query, assertDatabaseConfigured } from './db.js';
import { sendEmail } from './email.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_AUTH_URL = 'http://localhost:3333';
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

function normalizeUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

export function getAuthBaseUrl() {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return normalizeUrl(
    process.env.BETTER_AUTH_URL || (vercelHost ? `https://${vercelHost}` : ''),
    DEFAULT_AUTH_URL,
  );
}

export function getFrontendUrl() {
  return normalizeUrl(
    process.env.AUTH_FRONTEND_URL || process.env.FRONTEND_URL,
    process.env.VERCEL ? getAuthBaseUrl() : DEFAULT_FRONTEND_URL,
  );
}

export function getTrustedOrigins() {
  const configured = String(process.env.AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = [getAuthBaseUrl(), getFrontendUrl(), ...configured];
  return [...new Set(candidates.flatMap((value) => {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) ? [parsed.origin] : [];
    } catch {
      return [];
    }
  }))];
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

function displayNameFromEmail(email) {
  const localPart = email.split('@')[0] || 'Administrador';
  const words = localPart.split(/[._-]+/).filter(Boolean);
  const name = words.map((word) => `${word[0]?.toUpperCase() || ''}${word.slice(1)}`).join(' ');
  return name || 'Administrador';
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function deliverMagicLink({ email, url, token, metadata }) {
  const invitation = metadata?.purpose === 'invite';
  const subject = invitation
    ? 'Seu acesso ao Informer Tributário'
    : 'Entre no Informer Tributário';
  const title = invitation ? 'Seu acesso foi liberado' : 'Seu link de acesso';
  const safeUrl = escapeHtml(url);
  const linkFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 32);

  await sendEmail({
    to: email,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#173c3c;max-width:600px;margin:auto">
        <h1 style="font-size:24px">${title}</h1>
        <p>Use o botão abaixo para entrar com segurança. O link é pessoal, expira em 15 minutos e só pode ser usado uma vez.</p>
        <p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#0f6b63;color:#fff;text-decoration:none;border-radius:8px">Entrar no Informer</a></p>
        <p style="font-size:13px;color:#5d6d6d">Se você não solicitou este acesso, ignore esta mensagem.</p>
      </div>
    `,
    text: `${title}\n\nAcesse: ${url}\n\nO link expira em 15 minutos e só pode ser usado uma vez.`,
    idempotencyKey: `informer-magic-link-${linkFingerprint}`,
  });
}

const production = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export const auth = betterAuth({
  appName: 'Informer Tributário',
  baseURL: getAuthBaseUrl(),
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || undefined,
  database: getPool(),
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: 'database',
  },
  advanced: {
    cookiePrefix: 'informer',
    useSecureCookies: production,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    magicLink({
      expiresIn: 60 * 15,
      disableSignUp: true,
      storeToken: 'hashed',
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: deliverMagicLink,
    }),
  ],
});

export function validateAuthConfiguration() {
  assertDatabaseConfigured();
  const secret = String(process.env.BETTER_AUTH_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('BETTER_AUTH_SECRET deve ter pelo menos 32 caracteres aleatórios.');
    error.statusCode = 503;
    error.code = 'AUTH_SECRET_NOT_CONFIGURED';
    throw error;
  }
  const adminEmail = normalizeEmail(process.env.AUTH_ADMIN_EMAIL);
  if (!validEmail(adminEmail)) {
    const error = new Error('AUTH_ADMIN_EMAIL deve conter o e-mail válido do administrador inicial.');
    error.statusCode = 503;
    error.code = 'AUTH_ADMIN_NOT_CONFIGURED';
    throw error;
  }
  return { adminEmail };
}

export async function bootstrapAdminUser() {
  const { adminEmail } = validateAuthConfiguration();
  const adminName = String(process.env.AUTH_ADMIN_NAME || '').trim().slice(0, 120)
    || displayNameFromEmail(adminEmail);
  const result = await query(
    `INSERT INTO "user" ("name", "email", "emailVerified", "role", "banned", "createdAt", "updatedAt")
     VALUES ($1, $2, FALSE, 'admin', FALSE, NOW(), NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "role" = 'admin', "banned" = FALSE, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = NOW()
     RETURNING "id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt"`,
    [adminName, adminEmail],
  );
  const user = result.rows[0];
  await query(
    `INSERT INTO user_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id],
  );
  return user;
}

let initializationPromise = null;

export function initializeAuthPersistence() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    validateAuthConfiguration();
    await ensureAppSchema();
    await bootstrapAdminUser();
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

const betterAuthHandler = toNodeHandler(auth);

/** Mount on `/api/auth/*splat` before express.json() in Express 5. */
export async function authHandler(request, response, next) {
  try {
    await initializeAuthPersistence();
    return betterAuthHandler(request, response);
  } catch (error) {
    return next(error);
  }
}

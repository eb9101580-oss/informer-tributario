import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { admin } from 'better-auth/plugins';
import { toNodeHandler } from 'better-auth/node';
import { getPool, ensureAppSchema, query, assertDatabaseConfigured } from './db.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_AUTH_URL = 'http://localhost:3333';
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

function normalizeUrl(value, fallback) {
  try {
    const normalized = String(value || fallback).replace(/\uFEFF/g, '').trim();
    const url = new URL(normalized);
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

const production = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export const auth = betterAuth({
  appName: 'Informer Tributário',
  baseURL: getAuthBaseUrl(),
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || undefined,
  database: getPool(),
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
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
  const adminPassword = String(process.env.AUTH_ADMIN_PASSWORD || '');
  if (adminPassword.length < 10 || adminPassword.length > 128) {
    const error = new Error('AUTH_ADMIN_PASSWORD deve ter entre 10 e 128 caracteres.');
    error.statusCode = 503;
    error.code = 'AUTH_ADMIN_PASSWORD_NOT_CONFIGURED';
    throw error;
  }
  return { adminEmail, adminPassword };
}

function validateAuthRuntimeConfiguration() {
  assertDatabaseConfigured();
  const secret = String(process.env.BETTER_AUTH_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('BETTER_AUTH_SECRET deve ter pelo menos 32 caracteres aleatórios.');
    error.statusCode = 503;
    error.code = 'AUTH_SECRET_NOT_CONFIGURED';
    throw error;
  }
}

function hasAdminBootstrapCredentials() {
  const email = normalizeEmail(process.env.AUTH_ADMIN_EMAIL);
  const password = String(process.env.AUTH_ADMIN_PASSWORD || '');
  return validEmail(email) && password.length >= 10 && password.length <= 128;
}

export async function bootstrapAdminUser() {
  const { adminEmail, adminPassword } = validateAuthConfiguration();
  const adminName = String(process.env.AUTH_ADMIN_NAME || '').trim().slice(0, 120)
    || displayNameFromEmail(adminEmail);
  const result = await query(
    `INSERT INTO "user" ("name", "email", "emailVerified", "role", "banned", "createdAt", "updatedAt")
     VALUES ($1, $2, TRUE, 'admin', FALSE, NOW(), NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "role" = 'admin', "emailVerified" = TRUE, "banned" = FALSE, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = NOW()
     RETURNING "id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt"`,
    [adminName, adminEmail],
  );
  const user = result.rows[0];
  const credential = await query(
    `SELECT "id" FROM "account"
      WHERE "issuer" = 'local:credential' AND "accountId" = $1 AND "providerId" = 'credential'
      LIMIT 1`,
    [user.id],
  );
  if (!credential.rows[0]) {
    const password = await hashPassword(adminPassword);
    await query(
      `INSERT INTO "account" ("id", "issuer", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
       VALUES ($1, 'local:credential', $2, 'credential', $2, $3, NOW(), NOW())
       ON CONFLICT ("issuer", "accountId") DO NOTHING`,
      [randomUUID(), user.id, password],
    );
  }
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
    validateAuthRuntimeConfiguration();
    await ensureAppSchema();
    if (hasAdminBootstrapCredentials()) await bootstrapAdminUser();
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

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_POOL_SIZE = 5;
const APP_SCHEMA_LOCK_ID = 7_241_906_813;

export let pool = null;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function databaseConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export function assertDatabaseConfigured() {
  if (!databaseConfigured()) {
    const error = new Error('A autenticação requer DATABASE_URL apontando para o PostgreSQL/Neon.');
    error.statusCode = 503;
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
}

export function getPool() {
  if (pool) return pool;

  const connectionString = String(process.env.DATABASE_URL || '').trim() || undefined;
  pool = new Pool({
    connectionString,
    max: positiveInteger(process.env.DATABASE_POOL_MAX, DEFAULT_POOL_SIZE),
    idleTimeoutMillis: positiveInteger(process.env.DATABASE_IDLE_TIMEOUT_MS, 10_000),
    connectionTimeoutMillis: positiveInteger(process.env.DATABASE_CONNECT_TIMEOUT_MS, 10_000),
    keepAlive: true,
    allowExitOnIdle: process.env.NODE_ENV === 'test',
  });

  return pool;
}

/**
 * Execute a parameterized query. Never interpolate untrusted values into text.
 */
export async function query(text, values = []) {
  assertDatabaseConfigured();
  return getPool().query(text, values);
}

/**
 * Run work atomically with a PostgreSQL client.
 */
export async function transaction(work) {
  assertDatabaseConfigured();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Kept in runtime code so Vercel does not need to bundle a separate .sql asset.
// The auditable migration lives at migrations/001_auth_and_user_data.sql.
export const APP_SCHEMA_SQL = String.raw`
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "role" TEXT NOT NULL DEFAULT 'user',
  "banned" BOOLEAN NOT NULL DEFAULT FALSE,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ
);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "impersonatedBy" TEXT
);

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonatedBy" TEXT;
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "issuer" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("issuer", "accountId")
);

CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  email_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  action_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_score NUMERIC(3, 1) NOT NULL DEFAULT 8.0 CHECK (minimum_score BETWEEN 0 AND 10),
  digest_frequency TEXT NOT NULL DEFAULT 'instant' CHECK (digest_frequency IN ('instant', 'daily', 'never')),
  topic_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS publication_reactions (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  reaction SMALLINT NOT NULL CHECK (reaction IN (-1, 1)),
  source TEXT,
  section TEXT,
  topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, publication_id)
);

CREATE INDEX IF NOT EXISTS publication_reactions_user_updated_idx
  ON publication_reactions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS saved_publications (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, publication_id)
);

CREATE INDEX IF NOT EXISTS saved_publications_user_created_idx
  ON saved_publications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'feedback' CHECK (kind IN ('feedback', 'source')),
  title TEXT,
  message TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'accepted', 'rejected')),
  admin_response TEXT,
  reviewed_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_suggestions_status_created_idx
  ON user_suggestions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_suggestions_user_created_idx
  ON user_suggestions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT,
  source_type TEXT NOT NULL DEFAULT 'journalistic' CHECK (source_type IN ('official', 'journalistic', 'technical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'rejected')),
  approved_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS custom_sources_status_idx ON custom_sources (status);

CREATE TABLE IF NOT EXISTS tracked_actions (
  id TEXT PRIMARY KEY,
  process_number TEXT NOT NULL,
  tribunal TEXT NOT NULL,
  title TEXT NOT NULL,
  official_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  last_movement_key TEXT,
  created_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tribunal, process_number)
);

CREATE TABLE IF NOT EXISTS tracked_action_followers (
  tracked_action_id TEXT NOT NULL REFERENCES tracked_actions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  last_notified_movement_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tracked_action_id, user_id)
);

CREATE TABLE IF NOT EXISTS tracked_action_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_action_id TEXT NOT NULL REFERENCES tracked_actions(id) ON DELETE CASCADE,
  movement_key TEXT NOT NULL,
  movement_date TIMESTAMPTZ,
  title TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracked_action_id, movement_key)
);

CREATE INDEX IF NOT EXISTS tracked_action_movements_action_date_idx
  ON tracked_action_movements (tracked_action_id, movement_date DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_id TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (user_id, channel, event_type, event_key)
);

ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS notification_deliveries_status_created_idx
  ON notification_deliveries (status, created_at);
`;

let schemaPromise = null;

export function ensureAppSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [APP_SCHEMA_LOCK_ID]);
    await client.query(APP_SCHEMA_SQL);
  }).catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

export async function closePool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  schemaPromise = null;
  await currentPool.end();
}

/**
 * Postgres access for Morning Roast accounts.
 *
 * Provider-agnostic: set DATABASE_URL to any Postgres connection string
 * (Neon, Supabase, Render Postgres, etc.). SSL is enabled automatically
 * for non-local hosts.
 */
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "";

function needsSsl(url) {
  if (!url) return false;
  if (/sslmode=disable/i.test(url)) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return true;
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
    })
  : null;

function isEnabled() {
  return Boolean(pool);
}

async function query(text, params) {
  if (!pool) throw new Error("Database not configured (missing DATABASE_URL)");
  return pool.query(text, params);
}

async function initSchema() {
  if (!pool) {
    console.warn("[db] DATABASE_URL not set - account features disabled.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      username text NOT NULL,
      password_hash text NOT NULL,
      verified boolean NOT NULL DEFAULT false,
      verify_token_hash text,
      verify_expires timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));`
  );

  console.log("[db] Schema ready.");
}

module.exports = { pool, isEnabled, query, initSchema };

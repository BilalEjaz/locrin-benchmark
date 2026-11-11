// Postgres access (Neon in production). `Db` is the only thing the rest of the server knows about the database.
import pg from 'pg';

export interface Db { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

// bigint columns hold unix seconds / milliseconds: plain numbers
pg.types.setTypeParser(20, (v: string) => Number(v));

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS user_kv (
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS scripts (
  user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT FALSE, updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind, name)
);
CREATE INDEX IF NOT EXISTS scripts_public ON scripts (public, kind);
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, t BIGINT NOT NULL, o DOUBLE PRECISION NOT NULL, h DOUBLE PRECISION NOT NULL, l DOUBLE PRECISION NOT NULL, c DOUBLE PRECISION NOT NULL, v DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (symbol, tf, t)
);
CREATE TABLE IF NOT EXISTS candle_cov (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, from_t BIGINT NOT NULL, to_t BIGINT NOT NULL, PRIMARY KEY (symbol, tf)
);
CREATE TABLE IF NOT EXISTS shared_cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
);
`;

export function connect(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 6, idleTimeoutMillis: 20000, connectionTimeoutMillis: 15000 });
  // Neon closes idle connections: that must not take the process down
  pool.on('error', (e) => console.error('pg pool error', e.message));
  return pool;
}

export async function migrate(db: Db) { await db.query(SCHEMA); }

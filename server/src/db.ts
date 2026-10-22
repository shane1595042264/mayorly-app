import pg from 'pg'

// One Postgres pool. The schema is tiny and created on boot; there is no migration
// tool to run. Railway's public proxy presents a self-signed certificate; the private
// network (railway.internal) is already encrypted.

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

export const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: url.includes('railway.internal') || url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
})

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      google_id text NOT NULL UNIQUE,
      email text NOT NULL,
      name text,
      avatar_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS states (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      revision integer NOT NULL DEFAULT 0,
      state jsonb NOT NULL,
      device text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

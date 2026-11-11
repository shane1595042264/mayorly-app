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

// A connection that drops while idle is the pool's to replace. Unheard, this event takes the whole API down.
pool.on('error', (err) => console.error('[db] lost an idle connection:', err.message))

/** The schema, created and brought up to date on boot; every statement is safe to run again. */
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
    -- One-time codes that sign a phone in to an account a computer is already signed in to.
    -- Only a hash of the code is kept; a code lives ten minutes and is spent on first use.
    CREATE TABLE IF NOT EXISTS link_codes (
      code_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS feed_tokens (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- AI keys, encrypted on the user's computers with a key made from their sync passphrase.
    -- Nothing here can be read without it: the salt and scrypt settings let each computer make
    -- the same key, the check is a known phrase sealed with it so a wrong passphrase is caught.
    CREATE TABLE IF NOT EXISTS key_vaults (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      salt text NOT NULL,
      kdf jsonb NOT NULL,
      check_blob text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- One row per distinct key. The id is an HMAC of the key under the passphrase's key, so the
    -- same key from two computers lands on one row and the server cannot tell what it is. A row
    -- is live while added_at is later than deleted_at; both only ever move forward.
    -- The vault's own keys, so a device that signs in gets them without a passphrase. Sealed with a
    -- key the server makes from its own secret: the database alone does not open them, the running
    -- server does. Made by the first device that has the keys; gone with the vault.
    CREATE TABLE IF NOT EXISTS vault_escrow (
      user_id uuid PRIMARY KEY REFERENCES key_vaults(user_id) ON DELETE CASCADE,
      blob text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS vault_items (
      user_id uuid NOT NULL REFERENCES key_vaults(user_id) ON DELETE CASCADE,
      id text NOT NULL,
      blob text NOT NULL,
      added_at bigint NOT NULL,
      deleted_at bigint,
      PRIMARY KEY (user_id, id)
    );
  `)
}

/** Postgres may come up after the app does: try for a while before giving up. */
export async function migrateWithRetry(attempts = 10, waitMs = 3_000) {
  for (let i = 1; ; i++) {
    try {
      await migrate()
      return
    } catch (err) {
      if (i >= attempts) throw err
      console.error(`[db] not ready (attempt ${i} of ${attempts}):`, err instanceof Error ? err.message : err)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
}

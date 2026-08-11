import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

// Lazily create the pool on first query instead of at import time, so builds
// (which import route modules without runtime env vars) don't fail up front.
export function getPool(): Pool {
  if (global._pgPool) return global._pgPool

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  global._pgPool = pool
  return pool
}

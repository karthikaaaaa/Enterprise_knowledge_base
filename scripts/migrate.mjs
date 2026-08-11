import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env.local (or export it) before running migrations.')
    process.exit(1)
  }

  const sql = readFileSync(path.join(__dirname, '../lib/db/schema.sql'), 'utf8')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

  try {
    await pool.query(sql)
    console.log('Migration completed: documents, document_chunks tables and pgvector extension are ready.')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})

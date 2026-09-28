// One-time migration: copies existing chunks + embeddings from storage/chunks.json
// into storage/chunks.db (SQLite). Does not regenerate embeddings — it moves the
// already-computed vectors as-is. Safe to re-run: it recreates the table from scratch
// each time using the JSON file as the source of truth.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const STORE_DIR = path.join(process.cwd(), 'storage')
const JSON_FILE = path.join(STORE_DIR, 'chunks.json')
const DB_FILE = path.join(STORE_DIR, 'chunks.db')

function embeddingToBlob(embedding) {
  const floats = new Float32Array(embedding)
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)
}

function main() {
  const raw = readFileSync(JSON_FILE, 'utf-8')
  const chunks = JSON.parse(raw)
  console.log(`Read ${chunks.length} chunks from ${JSON_FILE}`)

  mkdirSync(STORE_DIR, { recursive: true })
  const db = new DatabaseSync(DB_FILE)

  db.exec('DROP TABLE IF EXISTS chunks')
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `)
  db.exec('CREATE INDEX idx_chunks_document_id ON chunks(document_id)')

  const insert = db.prepare(
    'INSERT INTO chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)',
  )

  db.exec('BEGIN')
  for (const chunk of chunks) {
    insert.run(chunk.id, chunk.documentId, chunk.chunkIndex, chunk.text, embeddingToBlob(chunk.embedding))
  }
  db.exec('COMMIT')

  const count = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n
  console.log(`Inserted ${count} rows into ${DB_FILE}`)
  db.close()
}

main()

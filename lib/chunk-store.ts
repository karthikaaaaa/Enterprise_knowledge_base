import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const STORE_DIR = path.join(process.cwd(), 'storage')
const DB_FILE = path.join(STORE_DIR, 'chunks.db')

export type StoredChunk = {
  id: string
  documentId: string
  chunkIndex: number
  text: string
  embedding: number[]
}

let dbInstance: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const db = new DatabaseSync(DB_FILE)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id)')
  dbInstance = db
  return db
}

function embeddingToBlob(embedding: number[]): Uint8Array {
  const floats = new Float32Array(embedding)
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)
}

function blobToEmbedding(blob: Uint8Array): number[] {
  const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT)
  return Array.from(floats)
}

type ChunkRow = {
  id: string
  documentId: string
  chunkIndex: number
  text: string
  embedding: Uint8Array
}

export async function getIndexedDocumentIds(): Promise<Set<string>> {
  const rows = getDb().prepare('SELECT DISTINCT document_id AS documentId FROM chunks').all() as Array<{ documentId: string }>
  return new Set(rows.map((row) => row.documentId))
}

export async function replaceChunksForDocument(
  documentId: string,
  chunks: Array<{ chunkIndex: number; text: string; embedding: number[] }>,
) {
  const db = getDb()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId)
    const insert = db.prepare(
      'INSERT INTO chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)',
    )
    for (const chunk of chunks) {
      insert.run(`${documentId}-${chunk.chunkIndex}`, documentId, chunk.chunkIndex, chunk.text, embeddingToBlob(chunk.embedding))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function deleteChunksForDocument(documentId: string) {
  getDb().prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId)
}

// Embeddings from the model are already unit-length, so a plain dot product equals cosine similarity.
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export async function searchSimilarChunks(queryEmbedding: number[], topK = 5) {
  const rows = getDb()
    .prepare('SELECT id, document_id AS documentId, chunk_index AS chunkIndex, text, embedding FROM chunks')
    .all() as unknown as ChunkRow[]

  return rows
    .map((row) => {
      const embedding = blobToEmbedding(row.embedding)
      return {
        id: row.id,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        embedding,
        score: dotProduct(queryEmbedding, embedding),
      } satisfies StoredChunk & { score: number }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

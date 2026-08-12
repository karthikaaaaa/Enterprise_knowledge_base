import { promises as fs } from 'node:fs'
import path from 'node:path'

const STORE_DIR = path.join(process.cwd(), 'storage')
const CHUNKS_FILE = path.join(STORE_DIR, 'chunks.json')

export type StoredChunk = {
  id: string
  documentId: string
  chunkIndex: number
  text: string
  embedding: number[]
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true })
  try {
    await fs.access(CHUNKS_FILE)
  } catch {
    await fs.writeFile(CHUNKS_FILE, '[]', 'utf-8')
  }
}

async function readAll(): Promise<StoredChunk[]> {
  await ensureStoreFile()
  try {
    const raw = await fs.readFile(CHUNKS_FILE, 'utf-8')
    return raw.trim() ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function writeAll(chunks: StoredChunk[]) {
  await ensureStoreFile()
  await fs.writeFile(CHUNKS_FILE, JSON.stringify(chunks), 'utf-8')
}

export async function getIndexedDocumentIds(): Promise<Set<string>> {
  const all = await readAll()
  return new Set(all.map((c) => c.documentId))
}

export async function replaceChunksForDocument(
  documentId: string,
  chunks: Array<{ chunkIndex: number; text: string; embedding: number[] }>,
) {
  const all = await readAll()
  const filtered = all.filter((c) => c.documentId !== documentId)
  const newChunks: StoredChunk[] = chunks.map((c) => ({
    id: `${documentId}-${c.chunkIndex}`,
    documentId,
    ...c,
  }))
  await writeAll([...filtered, ...newChunks])
}

export async function deleteChunksForDocument(documentId: string) {
  const all = await readAll()
  await writeAll(all.filter((c) => c.documentId !== documentId))
}

// Embeddings from the model are already unit-length, so a plain dot product equals cosine similarity.
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export async function searchSimilarChunks(queryEmbedding: number[], topK = 5) {
  const all = await readAll()
  return all
    .map((chunk) => ({ ...chunk, score: dotProduct(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

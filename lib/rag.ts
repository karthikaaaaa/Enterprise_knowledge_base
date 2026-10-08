import { GoogleGenAI } from '@google/genai'
import { getFile } from '@/lib/storage'
import { extractText } from '@/lib/text-extraction'
import { chunkText } from '@/lib/chunking'
import { embedText, embedTexts } from '@/lib/embeddings'
import { replaceChunksForDocument, deleteChunksForDocument, getIndexedDocumentIds, searchSimilarChunks } from '@/lib/chunk-store'
import { listDocuments, getDocumentById, updateProcessingStatus, type StoredDocument } from '@/lib/document-store'

/** Extracts, chunks, and embeds one document, then stores the result. Best-effort — never throws. */
export async function indexDocument(record: StoredDocument) {
  try {
    const buffer = await getFile(record.storedFilename)
    const text = await extractText(buffer, record.mimeType, record.originalName)

    if (!text || !text.trim()) {
      await deleteChunksForDocument(record.id)
      await updateProcessingStatus(record.id, 'failed')
      return
    }

    const chunks = chunkText(text)
    const embeddings = await embedTexts(chunks.map((c) => c.text))
    // Indexing runs fire-and-forget after upload/KB-entry creation, so the document may have been
    // deleted (e.g. a workflow Revert retracting an hr_approval profile) while embeddings were
    // being computed — don't resurrect orphaned chunks for it.
    if (!(await getDocumentById(record.id))) return
    await replaceChunksForDocument(
      record.id,
      chunks.map((c, i) => ({ chunkIndex: c.index, text: c.text, embedding: embeddings[i] })),
    )
    await updateProcessingStatus(record.id, 'processed')
  } catch (error) {
    console.error('[v0] Indexing failed for document', record.id, error)
    await updateProcessingStatus(record.id, 'failed')
  }
}

/** Indexes any uploaded document that isn't in the chunk store yet (covers documents uploaded before this feature existed). */
export async function ensureAllDocumentsIndexed() {
  const [docs, indexedIds] = await Promise.all([listDocuments(), getIndexedDocumentIds()])
  const toIndex = docs.filter((doc) => !indexedIds.has(doc.id))
  for (const doc of toIndex) {
    await indexDocument(doc)
  }
}

export type ChatSource = { id: string; name: string }
export type ChatAnswer = { answer: string; sources: ChatSource[] }

const SYSTEM_PROMPT =
  "You are a knowledge assistant for this company's document library. Answer the user's question using only the document excerpts provided below — do not use outside knowledge. If the excerpts don't contain the answer, say plainly that the uploaded documents don't cover it. Keep answers concise."

// Cosine similarity below this means the chunk isn't actually relevant (observed: relevant
// matches score ~0.45-0.55, unrelated ones ~0.02-0.05 with the MiniLM embedding model).
const MIN_RELEVANCE_SCORE = 0.3

/** `allowedDocumentIds` scopes retrieval to the documents the caller is allowed to see (see the
 * chat route) — omitted means the whole library, as before. */
export async function answerQuestion(question: string, allowedDocumentIds?: Set<string>): Promise<ChatAnswer> {
  await ensureAllDocumentsIndexed()

  const queryEmbedding = await embedText(question)
  const ranked = await searchSimilarChunks(queryEmbedding, 5, allowedDocumentIds)
  const matches = ranked.filter((m) => m.score >= MIN_RELEVANCE_SCORE)

  if (matches.length === 0) {
    return {
      answer: "I couldn't find any relevant information in your uploaded documents to answer that.",
      sources: [],
    }
  }

  const docs = await listDocuments()
  const docsById = new Map(docs.map((doc) => [doc.id, doc]))

  const contextBlocks = matches
    .map((match, i) => {
      const doc = docsById.get(match.documentId)
      return `[${i + 1}] Source: ${doc?.originalName ?? 'Unknown document'}\n${match.text}`
    })
    .join('\n\n')

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const response = await client.interactions.create({
    model: 'gemini-3.6-flash',
    system_instruction: SYSTEM_PROMPT,
    input: `Document excerpts:\n\n${contextBlocks}\n\nQuestion: ${question}`,
    generation_config: { max_output_tokens: 1024 },
  })

  const answer = response.output_text ?? ''

  const sources: ChatSource[] = Array.from(new Set(matches.map((m) => m.documentId))).map((id) => ({
    id,
    name: docsById.get(id)?.originalName ?? 'Unknown document',
  }))

  return { answer, sources }
}

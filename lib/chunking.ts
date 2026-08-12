export type TextChunk = { text: string; index: number }

/** Splits text into overlapping fixed-size chunks so each chunk carries some surrounding context. */
export function chunkText(text: string, chunkSize = 1000, overlap = 150): TextChunk[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const chunks: TextChunk[] = []
  let start = 0
  let index = 0
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length)
    chunks.push({ text: clean.slice(start, end), index })
    index += 1
    if (end === clean.length) break
    start = end - overlap
  }
  return chunks
}

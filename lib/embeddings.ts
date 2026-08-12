import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

/**
 * Local, in-process embedding model (Xenova/all-MiniLM-L6-v2, 384 dims). Runs fully offline
 * after the first download — no API key, no external embeddings provider required.
 */
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  }
  return extractorPromise
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const extractor = await getExtractor()
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const dims = output.dims as number[]
  const data = output.data as Float32Array
  const [count, dimSize] = dims
  const vectors: number[][] = []
  for (let i = 0; i < count; i++) {
    vectors.push(Array.from(data.slice(i * dimSize, (i + 1) * dimSize)))
  }
  return vectors
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text])
  return vector
}

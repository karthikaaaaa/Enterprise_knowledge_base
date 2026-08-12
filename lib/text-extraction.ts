import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/** Extracts plain text from a supported file for indexing. Returns null for unsupported types (images, xlsx, pptx, ...). */
export async function extractText(buffer: Buffer, mimeType: string, originalName: string): Promise<string | null> {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? ''

  try {
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      const result = await parser.getText()
      await parser.destroy()
      return result.text
    }

    if (WORD_MIME_TYPES.has(mimeType) || ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }

    if (mimeType.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) {
      return buffer.toString('utf-8')
    }
  } catch (error) {
    console.error('[v0] Text extraction failed:', error)
    return null
  }

  return null
}

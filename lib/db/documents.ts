import { getPool } from '@/lib/db/client'
import { extensionToType, formatBytes, mimeTypeFor } from '@/lib/document-format'
import type { Department } from '@/lib/documents'

export type DbDocument = {
  id: string
  filename: string
  original_filename: string
  file_type: string
  file_size: number
  blob_url: string
  department: string
  uploaded_by: string | null
  uploaded_at: string
  status: string
}

export async function insertDocument(doc: {
  filename: string
  originalFilename: string
  fileType: string
  fileSize: number
  blobUrl: string
  department: string
  uploadedBy?: string | null
}): Promise<DbDocument> {
  const result = await getPool().query<DbDocument>(
    `INSERT INTO documents (filename, original_filename, file_type, file_size, blob_url, department, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [doc.filename, doc.originalFilename, doc.fileType, doc.fileSize, doc.blobUrl, doc.department, doc.uploadedBy ?? null],
  )
  return result.rows[0]
}

export async function listDocuments(): Promise<DbDocument[]> {
  const result = await getPool().query<DbDocument>(`SELECT * FROM documents ORDER BY uploaded_at DESC`)
  return result.rows
}

export async function getDocumentById(id: string): Promise<DbDocument | null> {
  const result = await getPool().query<DbDocument>(`SELECT * FROM documents WHERE id = $1`, [id])
  return result.rows[0] ?? null
}

export async function renameDocument(id: string, originalFilename: string): Promise<DbDocument | null> {
  const result = await getPool().query<DbDocument>(
    `UPDATE documents SET original_filename = $2 WHERE id = $1 RETURNING *`,
    [id, originalFilename],
  )
  return result.rows[0] ?? null
}

export async function deleteDocument(id: string): Promise<DbDocument | null> {
  const result = await getPool().query<DbDocument>(`DELETE FROM documents WHERE id = $1 RETURNING *`, [id])
  return result.rows[0] ?? null
}

// Shapes a DB row into the document object the existing Knowledge Base UI expects.
export function toApiDocument(row: DbDocument) {
  return {
    id: row.id,
    name: row.original_filename,
    pathname: row.blob_url,
    mimeType: mimeTypeFor(row.original_filename),
    type: extensionToType(row.original_filename),
    department: row.department as Department,
    uploadedAt: new Date(row.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    size: formatBytes(row.file_size),
    sizeBytes: row.file_size,
    pages: 1,
    owner: row.uploaded_by ?? 'Unknown',
    pinned: false,
    indexed: row.status === 'indexed',
    summary: 'Newly uploaded document. AI indexing will be available after processing.',
    tags: ['New upload'],
    status: row.status,
  }
}

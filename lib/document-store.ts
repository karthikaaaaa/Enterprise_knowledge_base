import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { departments, type Department } from '@/lib/documents'

const STORE_DIR = path.join(process.cwd(), 'storage')
const STORE_FILE = path.join(STORE_DIR, 'documents.json')

export type ProcessingStatus = 'pending' | 'processed' | 'failed'

export type StoredDocument = {
  id: string
  originalName: string
  storedFilename: string
  filePath: string
  mimeType: string
  size: number
  department: Department
  access: string
  uploadedBy: string
  /** Current owner, when ownership has been handed over (offboarding knowledge transfer). Absent
   * on older records — the uploader is the owner then (see documentOwner). */
  owner?: string
  createdAt: string
  processingStatus: ProcessingStatus
  /** Which department sections this document should appear under, besides "All". */
  visibleDepartments: Department[]
}

/** "All employees" docs belong in every department section, not just their own. */
function computeVisibleDepartments(department: Department, access: string): Department[] {
  return access === 'All employees' ? departments : [department]
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true })
  try {
    await fs.access(STORE_FILE)
  } catch {
    await fs.writeFile(STORE_FILE, '[]', 'utf-8')
  }
}

async function readAll(): Promise<StoredDocument[]> {
  await ensureStoreFile()
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8')
    return raw.trim() ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function writeAll(records: StoredDocument[]) {
  await ensureStoreFile()
  await fs.writeFile(STORE_FILE, JSON.stringify(records, null, 2), 'utf-8')
}

export async function listDocuments() {
  return readAll()
}

export async function getDocumentById(id: string) {
  const all = await readAll()
  return all.find((doc) => doc.id === id) ?? null
}

export async function addDocument(
  input: Omit<StoredDocument, 'id' | 'createdAt' | 'processingStatus' | 'visibleDepartments'>,
) {
  const all = await readAll()
  const record: StoredDocument = {
    id: `upload-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    processingStatus: 'pending',
    ...input,
    visibleDepartments: computeVisibleDepartments(input.department, input.access),
  }
  all.push(record)
  await writeAll(all)
  return record
}

export async function deleteDocument(id: string) {
  const all = await readAll()
  const index = all.findIndex((doc) => doc.id === id)
  if (index === -1) return null
  const [removed] = all.splice(index, 1)
  await writeAll(all)
  return removed
}

export async function renameDocument(id: string, newName: string) {
  const all = await readAll()
  const index = all.findIndex((doc) => doc.id === id)
  if (index === -1) return null
  all[index] = { ...all[index], originalName: newName }
  await writeAll(all)
  return all[index]
}

/** Who owns a document right now: an explicit owner if one was assigned, else the uploader. */
export function documentOwner(record: Pick<StoredDocument, 'owner' | 'uploadedBy'>) {
  return record.owner ?? record.uploadedBy
}

/** Reassigns a document's owner (knowledge transfer) — reversible: pass the previous owner back. */
export async function setDocumentOwner(id: string, owner: string) {
  const all = await readAll()
  const index = all.findIndex((doc) => doc.id === id)
  if (index === -1) return null
  all[index] = { ...all[index], owner }
  await writeAll(all)
  return all[index]
}

export async function updateProcessingStatus(id: string, status: ProcessingStatus) {
  const all = await readAll()
  const index = all.findIndex((doc) => doc.id === id)
  if (index === -1) return null
  all[index] = { ...all[index], processingStatus: status }
  await writeAll(all)
  return all[index]
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extToType(name: string): 'pdf' | 'doc' | 'sheet' | 'slides' {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet'
  if (['ppt', 'pptx'].includes(ext)) return 'slides'
  return 'doc'
}

/** Maps the stored metadata record to the shape the UI/API already expects (matches the old Blob-derived response). */
export function mapToApiDocument(record: StoredDocument) {
  return {
    id: record.id,
    name: record.originalName,
    pathname: record.storedFilename,
    // Derived from storedFilename (immutable) rather than originalName, so renaming
    // a document never changes how it's previewed (e.g. stripping a .pdf extension).
    type: extToType(record.storedFilename),
    mimeType: record.mimeType,
    sizeBytes: record.size,
    size: formatBytes(record.size),
    uploadedAt: record.createdAt,
    department: record.department,
    access: record.access,
    // Existing records saved before this field existed won't have it on disk; derive it the same way.
    visibleDepartments: record.visibleDepartments ?? computeVisibleDepartments(record.department, record.access),
    pages: 1,
    owner: documentOwner(record),
    pinned: false,
    indexed: record.processingStatus === 'processed',
    summary: 'Newly uploaded document. AI indexing will be available after processing.',
    tags: ['New upload'],
  }
}

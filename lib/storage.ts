import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'documents')

async function ensureStorageDir() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true })
}

function sanitizeFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? name
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return safe || 'file'
}

function generateStoredFilename(originalName: string) {
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  return `${unique}-${sanitizeFilename(originalName)}`
}

/** Resolves a stored filename to an absolute path, rejecting anything that could escape STORAGE_ROOT. */
function resolveSafePath(storedFilename: string) {
  if (
    !storedFilename ||
    storedFilename.includes('..') ||
    path.isAbsolute(storedFilename) ||
    /[/\\]/.test(storedFilename)
  ) {
    throw new Error('Invalid stored filename')
  }
  const resolved = path.resolve(STORAGE_ROOT, storedFilename)
  if (resolved !== path.join(STORAGE_ROOT, storedFilename)) {
    throw new Error('Path traversal detected')
  }
  return resolved
}

export async function saveFile(buffer: Buffer, originalName: string) {
  await ensureStorageDir()
  const storedFilename = generateStoredFilename(originalName)
  const fullPath = resolveSafePath(storedFilename)
  await fs.writeFile(fullPath, buffer)
  const stats = await fs.stat(fullPath)
  return { storedFilename, size: stats.size }
}

export async function getFile(storedFilename: string) {
  const fullPath = resolveSafePath(storedFilename)
  return fs.readFile(fullPath)
}

export async function deleteFile(storedFilename: string) {
  const fullPath = resolveSafePath(storedFilename)
  try {
    await fs.unlink(fullPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

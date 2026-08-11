import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { documents } from '@/lib/documents'

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'knowledge-base/' })
    const uploaded = blobs.map((blob) => ({
      id: `upload-${blob.pathname.replace(/^knowledge-base\//, '')}`,
      name: blob.pathname.split('/').pop()?.replace(/^\d+-/, '') ?? blob.pathname,
      pathname: blob.pathname,
      type: blob.pathname.split('.').pop()?.toLowerCase() ?? 'file',
      mimeType: mimeTypeFor(blob.pathname),
      size: formatBytes(blob.size),
      sizeBytes: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      department: 'Policies',
      access: 'All employees',
      pages: 1,
      owner: 'Amara Okafor',
      pinned: false,
      indexed: false,
      summary: 'Newly uploaded document. AI indexing will be available after processing.',
      tags: ['New upload'],
    }))
    return NextResponse.json([...uploaded, ...documents])
  } catch (error) {
    console.error('[v0] Document listing failed:', error)
    return NextResponse.json(documents)
  }
}

function mimeTypeFor(pathname: string) {
  const ext = pathname.split('.').pop()?.toLowerCase()
  return ext === 'pdf' ? 'application/pdf' : ext === 'txt' || ext === 'md' || ext === 'csv' ? 'text/plain' : 'application/octet-stream'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

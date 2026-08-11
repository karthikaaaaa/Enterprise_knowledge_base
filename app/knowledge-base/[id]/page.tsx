import { notFound } from 'next/navigation'
import { list } from '@vercel/blob'
import { AppShell } from '@/components/dashboard/app-shell'
import { DocumentDetail } from '@/components/knowledge/document-detail'
import { getDocument } from '@/lib/documents'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const staticDoc = getDocument(id)
  if (staticDoc) return <AppShell><DocumentDetail doc={staticDoc} /></AppShell>

  try {
    const { blobs } = await list({ prefix: 'knowledge-base/' })
    const blob = blobs.find((item) => `upload-${item.pathname.replace(/^knowledge-base\//, '')}` === id)
    if (!blob) notFound()
    const name = blob.pathname.split('/').pop()?.replace(/^\d+-/, '') ?? 'Uploaded document'
    const doc = {
      id,
      name,
      pathname: blob.pathname,
      mimeType: mimeTypeFor(name),
      department: 'Policies' as const,
      type: extensionToType(name),
      uploadedAt: blob.uploadedAt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      size: formatBytes(blob.size),
      pages: 1,
      owner: 'Amara Okafor',
      pinned: false,
      indexed: false,
      summary: 'Newly uploaded document. AI indexing will be available after processing.',
      tags: ['New upload'],
    }
    return <AppShell><DocumentDetail doc={doc} /></AppShell>
  } catch { notFound() }
}

function mimeTypeFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'pdf' ? 'application/pdf' : ext === 'txt' || ext === 'md' || ext === 'csv' ? 'text/plain' : 'application/octet-stream'
}

function extensionToType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf' as const
  if (['xls', 'xlsx', 'csv'].includes(ext ?? '')) return 'sheet' as const
  if (['ppt', 'pptx'].includes(ext ?? '')) return 'slides' as const
  return 'doc' as const
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

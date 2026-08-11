import { notFound } from 'next/navigation'
import { AppShell } from '@/components/dashboard/app-shell'
import { DocumentDetail } from '@/components/knowledge/document-detail'
import { getDocument } from '@/lib/documents'
import { getDocumentById, toApiDocument } from '@/lib/db/documents'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const staticDoc = getDocument(id)
  if (staticDoc) return <AppShell><DocumentDetail doc={staticDoc} /></AppShell>

  try {
    const row = await getDocumentById(id)
    if (!row) notFound()
    return <AppShell><DocumentDetail doc={toApiDocument(row)} /></AppShell>
  } catch {
    notFound()
  }
}

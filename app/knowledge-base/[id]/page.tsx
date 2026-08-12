import { notFound } from 'next/navigation'
import { AppShell } from '@/components/dashboard/app-shell'
import { DocumentDetail } from '@/components/knowledge/document-detail'
import { getDocumentById, mapToApiDocument } from '@/lib/document-store'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const record = await getDocumentById(id)
  if (!record) notFound()
  return <AppShell><DocumentDetail doc={mapToApiDocument(record)} /></AppShell>
}

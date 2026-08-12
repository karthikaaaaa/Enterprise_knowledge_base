import { NextResponse } from 'next/server'
import { deleteFile } from '@/lib/storage'
import { deleteDocument, renameDocument, mapToApiDocument } from '@/lib/document-store'
import { deleteChunksForDocument } from '@/lib/chunk-store'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const removed = await deleteDocument(id)
    if (!removed) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    await deleteFile(removed.storedFilename)
    await deleteChunksForDocument(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Document delete failed:', error)
    return NextResponse.json({ error: 'Delete failed. Please try again.' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    const record = await renameDocument(id, name)
    if (!record) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json(mapToApiDocument(record))
  } catch (error) {
    console.error('[v0] Document rename failed:', error)
    return NextResponse.json({ error: 'Rename failed. Please try again.' }, { status: 500 })
  }
}

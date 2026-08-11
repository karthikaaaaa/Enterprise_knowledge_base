import { del } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { deleteDocument, getDocumentById, renameDocument, toApiDocument } from '@/lib/db/documents'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'A document name is required' }, { status: 400 })

    const updated = await renameDocument(id, name)
    if (!updated) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    return NextResponse.json(toApiDocument(updated))
  } catch (error) {
    console.error('[v0] Document rename failed:', error)
    return NextResponse.json({ error: 'Rename failed. Please try again.' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const doc = await getDocumentById(id)
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    await del(doc.blob_url)
    await deleteDocument(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Document delete failed:', error)
    return NextResponse.json({ error: 'Delete failed. Please try again.' }, { status: 500 })
  }
}

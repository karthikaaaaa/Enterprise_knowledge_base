import { del, put } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { insertDocument, toApiDocument } from '@/lib/db/documents'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const department = String(formData.get('department') ?? 'Policies')
    const uploadedBy = formData.get('uploadedBy') ? String(formData.get('uploadedBy')) : null

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 413 })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
    const blob = await put(`knowledge-base/${Date.now()}-${safeName}`, file, {
      access: 'private',
      addRandomSuffix: false,
      contentType: file.type || 'application/octet-stream',
    })

    const fileType = file.name.split('.').pop()?.toLowerCase() ?? 'file'

    try {
      const row = await insertDocument({
        filename: blob.pathname,
        originalFilename: file.name,
        fileType,
        fileSize: file.size,
        blobUrl: blob.pathname,
        department,
        uploadedBy,
      })
      return NextResponse.json(toApiDocument(row))
    } catch (dbError) {
      // Roll back the blob so we don't leave an orphaned file that never shows up in the UI.
      await del(blob.pathname).catch(() => {})
      throw dbError
    }
  } catch (error) {
    console.error('[v0] Document upload failed:', error)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}

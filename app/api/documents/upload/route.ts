import { NextResponse } from 'next/server'
import { saveFile } from '@/lib/storage'
import { addDocument, mapToApiDocument } from '@/lib/document-store'
import { indexDocument } from '@/lib/rag'
import type { Department } from '@/lib/documents'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const department = String(formData.get('department') ?? 'Policies') as Department
    const access = String(formData.get('access') ?? 'All employees')
    const uploadedByRaw = formData.get('uploadedBy')
    const uploadedBy = typeof uploadedByRaw === 'string' && uploadedByRaw.trim() ? uploadedByRaw.trim() : 'Unknown uploader'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { storedFilename, size } = await saveFile(buffer, file.name)

    const record = await addDocument({
      originalName: file.name,
      storedFilename,
      filePath: `storage/documents/${storedFilename}`,
      mimeType: file.type || 'application/octet-stream',
      size,
      department,
      access,
      uploadedBy,
    })

    // Fire-and-forget: index for chat search without delaying the upload response.
    indexDocument(record).catch((error) => console.error('[v0] Background indexing failed:', error))

    return NextResponse.json(mapToApiDocument(record))
  } catch (error) {
    console.error('[v0] Document upload failed:', error)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}

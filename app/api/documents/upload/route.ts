import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const department = String(formData.get('department') ?? 'Policies')
    const access = String(formData.get('access') ?? 'All employees')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 413 })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
    const blob = await put(`knowledge-base/${Date.now()}-${safeName}`, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type || 'application/octet-stream',
    })

    return NextResponse.json({
      id: `upload-${blob.pathname.replace(/^knowledge-base\//, '')}`,
      name: file.name,
      pathname: blob.pathname,
      type: file.name.split('.').pop()?.toLowerCase() ?? 'file',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      size: formatBytes(file.size),
      uploadedAt: new Date().toISOString(),
      department,
      access,
      pages: 1,
      owner: 'Amara Okafor',
      pinned: false,
      indexed: false,
      summary: 'Newly uploaded document. AI indexing will be available after processing.',
      tags: ['New upload'],
    })
  } catch (error) {
    console.error('[v0] Document upload failed:', error)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

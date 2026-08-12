import { NextResponse } from 'next/server'
import { getFile } from '@/lib/storage'
import { listDocuments } from '@/lib/document-store'

export async function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get('pathname')
  if (!pathname) return NextResponse.json({ error: 'Missing pathname' }, { status: 400 })

  try {
    const docs = await listDocuments()
    const record = docs.find((doc) => doc.storedFilename === pathname)
    const buffer = await getFile(pathname)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': record?.mimeType ?? 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename="${record?.originalName ?? pathname}"`,
      },
    })
  } catch (error) {
    console.error('[v0] Local file delivery failed:', error)
    return NextResponse.json({ error: 'Unable to read file' }, { status: 404 })
  }
}

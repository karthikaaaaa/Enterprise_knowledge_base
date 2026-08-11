import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get('pathname')
  if (!pathname) return NextResponse.json({ error: 'Missing pathname' }, { status: 400 })

  try {
    const result = await get(pathname, { access: 'private' })
    if (!result) return new NextResponse('Not found', { status: 404 })
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType ?? 'application/octet-stream',
        'Content-Length': String(result.blob.size ?? ''),
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename="${pathname.split('/').pop() ?? 'document'}"`,
      },
    })
  } catch (error) {
    console.error('[v0] Private file delivery failed:', error)
    return NextResponse.json({ error: 'Unable to read file' }, { status: 404 })
  }
}

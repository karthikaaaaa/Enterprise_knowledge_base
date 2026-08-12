import mammoth from 'mammoth'
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { getFile } from '@/lib/storage'
import { listDocuments } from '@/lib/document-store'

const allowedFiles = new Set([
  'mutual-nda-template.docx',
  'new-hire-onboarding-checklist.docx',
])

function renderHtml(bodyHtml: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Inter,Arial,sans-serif;background:#fff;color:#16233a;line-height:1.6;max-width:760px;margin:0 auto;padding:48px}h1,h2,h3{color:#16233a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d8e1ee;padding:8px;text-align:left}p{margin:0 0 16px}</style></head><body>${bodyHtml}</body></html>`
}

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('pathname')
  const filename = request.nextUrl.searchParams.get('filename')

  try {
    if (pathname) {
      const docs = await listDocuments()
      const record = docs.find((doc) => doc.storedFilename === pathname)
      if (!record) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      const buffer = await getFile(pathname)
      const result = await mammoth.convertToHtml({ buffer })
      return new NextResponse(renderHtml(result.value), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    if (!filename || !allowedFiles.has(filename)) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    const result = await mammoth.convertToHtml({ path: path.join(process.cwd(), 'public', 'documents', filename) })
    return new NextResponse(renderHtml(result.value), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (error) {
    console.error('[v0] Word preview failed:', error)
    return NextResponse.json({ error: 'Unable to preview document' }, { status: 500 })
  }
}

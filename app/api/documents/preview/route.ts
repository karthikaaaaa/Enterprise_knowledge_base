import mammoth from 'mammoth'
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'

const allowedFiles = new Set([
  'mutual-nda-template.docx',
  'new-hire-onboarding-checklist.docx',
])

export async function GET(request: NextRequest) {
  const filename = request.nextUrl.searchParams.get('filename')
  if (!filename || !allowedFiles.has(filename)) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  try {
    const result = await mammoth.convertToHtml({ path: path.join(process.cwd(), 'public', 'documents', filename) })
    return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Inter,Arial,sans-serif;background:#fff;color:#16233a;line-height:1.6;max-width:760px;margin:0 auto;padding:48px}h1,h2,h3{color:#16233a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d8e1ee;padding:8px;text-align:left}p{margin:0 0 16px}</style></head><body>${result.value}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (error) {
    console.error('[v0] Word preview failed:', error)
    return NextResponse.json({ error: 'Unable to preview document' }, { status: 500 })
  }
}

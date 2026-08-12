import { NextResponse } from 'next/server'
import { listDocuments, mapToApiDocument } from '@/lib/document-store'

export async function GET() {
  try {
    const records = await listDocuments()
    const uploaded = records.slice().reverse().map(mapToApiDocument)
    return NextResponse.json(uploaded)
  } catch (error) {
    console.error('[v0] Document listing failed:', error)
    return NextResponse.json([])
  }
}

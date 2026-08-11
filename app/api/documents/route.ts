import { NextResponse } from 'next/server'
import { documents } from '@/lib/documents'
import { listDocuments, toApiDocument } from '@/lib/db/documents'

export async function GET() {
  try {
    const rows = await listDocuments()
    const uploaded = rows.map(toApiDocument)
    return NextResponse.json([...uploaded, ...documents])
  } catch (error) {
    console.error('[v0] Document listing failed:', error)
    return NextResponse.json(documents)
  }
}

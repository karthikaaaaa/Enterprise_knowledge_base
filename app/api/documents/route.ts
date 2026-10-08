import { NextResponse } from 'next/server'
import { listDocuments, mapToApiDocument } from '@/lib/document-store'
import { getCaller } from '@/lib/server-auth'
import { resolveKbAccess } from '@/lib/kb-access'

export async function GET(request: Request) {
  try {
    const records = await listDocuments()
    // An onboarding Employee only ever receives the categories HR has granted them (nothing before
    // the grant) — enforced here, not just hidden client-side. Everyone else gets the full list and
    // the usual role/department filtering in canViewDocument, unchanged.
    const kbAccess = resolveKbAccess(getCaller(request))
    const visible = kbAccess.restricted ? records.filter((r) => kbAccess.categories.includes(r.department)) : records
    const uploaded = visible.slice().reverse().map(mapToApiDocument)
    return NextResponse.json(uploaded)
  } catch (error) {
    console.error('[v0] Document listing failed:', error)
    return NextResponse.json([])
  }
}

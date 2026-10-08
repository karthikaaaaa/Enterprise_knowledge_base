import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { resolveKbAccess } from '@/lib/kb-access'

/** The caller's Knowledge Base grant state (see lib/kb-access.ts) — the client feeds this into
 * canViewDocument/allowedDocumentDepartments so the chips and detail page match what
 * GET /api/documents actually returns for them. */
export async function GET(request: Request) {
  return NextResponse.json(resolveKbAccess(getCaller(request)))
}

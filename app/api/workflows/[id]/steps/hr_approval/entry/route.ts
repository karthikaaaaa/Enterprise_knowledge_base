import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestHrApprovalProfileEntry } from '@/lib/workflow-store'

/** The stored AI-generated profile preview — HR-facing only, since reviewing it before verifying
 * is HR's job in this flow. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'HR' && caller.role.name !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!getWorkflow(id)) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const entry = getLatestHrApprovalProfileEntry(id)
  if (!entry) {
    return NextResponse.json({ error: 'Profile entry has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ entry })
}

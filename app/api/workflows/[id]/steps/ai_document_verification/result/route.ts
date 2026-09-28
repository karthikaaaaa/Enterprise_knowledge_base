import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestDocumentVerificationResult } from '@/lib/workflow-store'

/** The stored AI cross-check summary — HR-facing only, since reviewing it is HR's job in this flow. */
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

  const result = getLatestDocumentVerificationResult(id)
  if (!result) {
    return NextResponse.json({ error: 'AI verification has not been run yet' }, { status: 404 })
  }

  return NextResponse.json({ result })
}

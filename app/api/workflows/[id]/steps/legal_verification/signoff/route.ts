import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { createLegalSignoffPack, getLegalSignoffDraft, type CreateLegalRecordError } from '@/lib/legal-records'

const ERROR_STATUS: Record<CreateLegalRecordError, number> = {
  workflow_not_found: 404,
  not_awaiting_legal: 409,
  already_created: 409,
  not_ready: 409,
}

const ERROR_MESSAGE: Record<CreateLegalRecordError, string> = {
  workflow_not_found: 'Workflow not found',
  not_awaiting_legal: 'Legal Verification is not waiting on Legal right now',
  already_created: 'A compliance sign-off pack already exists for this employee',
  not_ready: 'The compliance sign-off pack cannot be created yet',
}

/** The drafted compliance sign-off pack (and the created one, if any). Legal and HR/Administrator. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Legal', 'HR', 'Administrator'].includes(caller.role.name)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!getWorkflow(id)) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  const { draft, record } = getLegalSignoffDraft(id)
  return NextResponse.json({ draft, record: record ? { id: record.id, createdAt: record.createdAt } : null })
}

/** Legal only: create the compliance sign-off pack once every prerequisite is in place. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Legal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const result = await createLegalSignoffPack(id, caller.user.id, { defer: (task) => after(task) })
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ recordId: result.record.id })
}

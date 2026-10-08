import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { createExpenseAccountFromDraft, getExpenseAccountDraft, type CreateFinanceRecordError } from '@/lib/finance-records'

const ERROR_STATUS: Record<CreateFinanceRecordError, number> = {
  workflow_not_found: 404,
  not_awaiting_finance: 409,
  already_created: 409,
  not_ready: 409,
}

const ERROR_MESSAGE: Record<CreateFinanceRecordError, string> = {
  workflow_not_found: 'Workflow not found',
  not_awaiting_finance: 'Finance Verification is not waiting on Finance right now',
  already_created: 'An expense account already exists for this employee',
  not_ready: 'The expense account cannot be created yet',
}

/** The drafted expense account (and the created one, if any). Finance and HR/Administrator. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Finance', 'HR', 'Administrator'].includes(caller.role.name)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  if (!getWorkflow(id)) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  const { draft, record } = getExpenseAccountDraft(id)
  return NextResponse.json({
    draft,
    record: record ? { id: record.id, costCenter: record.costCenter, approverName: record.approverName, createdAt: record.createdAt } : null,
  })
}

/** Finance only: create the expense account exactly as drafted. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Finance') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const result = await createExpenseAccountFromDraft(id, caller.user.id, { defer: (task) => after(task) })
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ recordId: result.record.id })
}

import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { confirmLegalClearance, getLegalClearanceState, type LegalClearanceError } from '@/lib/offboarding/legal-clearance'

const ERROR_STATUS: Record<LegalClearanceError, number> = {
  workflow_not_found: 404,
  not_awaiting_legal: 409,
  not_allowed: 403,
  already_on_record: 409,
  invalid_input: 400,
}

const ERROR_MESSAGE: Record<LegalClearanceError, string> = {
  workflow_not_found: 'Offboarding workflow not found',
  not_awaiting_legal: 'Legal Clearance is not waiting on Legal right now',
  not_allowed: 'Only the assigned Legal approver can confirm this',
  already_on_record: 'This is already settled by a record on file',
  invalid_input: 'Invalid input',
}

/** Which Legal Clearance tasks need Legal to confirm them, and what Legal has confirmed. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Legal', 'HR', 'Administrator'].includes(caller.role.name)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const state = getLegalClearanceState(id)
  if (!state) return NextResponse.json({ error: ERROR_MESSAGE.workflow_not_found }, { status: 404 })
  return NextResponse.json({ ...state, canConfirm: state.canConfirm && caller.role.name === 'Legal' })
}

/** Legal only: confirm a task the records can't settle. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Legal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const result = await confirmLegalClearance(
    id,
    caller.user.id,
    { task: body.task, clausesApply: body.clausesApply, clauses: body.clauses, note: body.note },
    { defer: (task) => after(task) },
  )
  if (!result.ok) return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  return NextResponse.json({ ok: true })
}

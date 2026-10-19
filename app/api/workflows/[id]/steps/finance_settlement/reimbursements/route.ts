import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { confirmReimbursements, type FinalPayError } from '@/lib/offboarding/final-pay'

const ERROR_STATUS: Record<FinalPayError, number> = {
  workflow_not_found: 404,
  not_awaiting_finance: 409,
  not_allowed: 403,
  already_calculated: 409,
  invalid_input: 400,
  no_statement: 409,
}

const ERROR_MESSAGE: Record<FinalPayError, string> = {
  workflow_not_found: 'Offboarding workflow not found',
  not_awaiting_finance: 'Finance Settlement is not waiting on Finance right now',
  not_allowed: 'Only the assigned Finance approver can confirm the reimbursements',
  already_calculated: 'Already recorded',
  invalid_input: 'Invalid input',
  no_statement: 'Run the settlement review first',
}

/** Finance only: confirm the pending reimbursements (none outstanding, or the outstanding amount).
 * The current confirmation is returned by GET .../finance_settlement/final-pay. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Finance') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const result = await confirmReimbursements(
    id,
    caller.user.id,
    { outstanding: body.outstanding, amount: body.amount, currency: body.currency, note: body.note },
    { defer: (task) => after(task) },
  )
  if (!result.ok) return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  return NextResponse.json({ ok: true })
}

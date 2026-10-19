import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { enterFinalPay, getFinalPayState, type FinalPayError } from '@/lib/offboarding/final-pay'

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
  not_allowed: 'Only the assigned Finance approver can enter the final pay',
  already_calculated: 'The final pay is already calculated from payroll',
  invalid_input: 'Invalid input',
  no_statement: 'Run the settlement review first',
}

/** The current final pay (calculated, entered by Finance, or placeholder) and whether Finance can enter it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Finance', 'HR', 'Administrator'].includes(caller.role.name)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const state = getFinalPayState(id)
  if (!state) return NextResponse.json({ error: ERROR_MESSAGE.workflow_not_found }, { status: 404 })
  const isFinance = caller.role.name === 'Finance'
  return NextResponse.json({ ...state, canEnter: state.canEnter && isFinance, canConfirmReimbursements: state.canConfirmReimbursements && isFinance })
}

/** Finance only: enter (or correct) the final pay when payroll can't calculate it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Finance') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const result = await enterFinalPay(id, caller.user.id, { amount: body.amount, currency: body.currency, note: body.note }, { defer: (task) => after(task) })
  if (!result.ok) return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  return NextResponse.json({ ok: true })
}

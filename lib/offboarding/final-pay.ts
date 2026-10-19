import { getUserById, runInTransaction } from '@/lib/workflow-store'
import { approvalAwaiting, notifyRoleAbout, rerunAfter, type RecordOptions, type RerunOutcome } from '@/lib/structured-review'
import { loadOffboarding, exitDetailsFor, stepOf, departmentHead } from '@/lib/offboarding/context'
import { getSettlementStatement, upsertSettlementStatement, recordWorkflowEvent } from '@/lib/offboarding/store'
import { computeSettlement, manualFinalPayFor, reimbursementConfirmationFor, type ManualFinalPay, type ReimbursementConfirmation } from '@/lib/offboarding/reviews'

/**
 * Finance Settlement: when the final pay can't be calculated from payroll (no salary on file, or no
 * last working day), Finance enters it by hand. The entry lives on the settlement statement and
 * the review uses it in place of the placeholder (lib/offboarding/reviews.ts computeSettlement);
 * a payroll-calculated figure always wins. Reverting Finance Settlement voids the statement, which
 * clears the entry.
 *
 * Pending reimbursements work the same way: no claims system is connected, so Finance confirms
 * either that nothing is outstanding or the outstanding amount to pay with the settlement.
 */

const STEP_KEY = 'finance_settlement'

export type FinalPayError = 'workflow_not_found' | 'not_awaiting_finance' | 'not_allowed' | 'already_calculated' | 'invalid_input' | 'no_statement'

export function getFinalPayState(workflowId: string) {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return null
  const { finalPay } = computeSettlement(ctx, exitDetailsFor(ctx))
  return {
    finalPay,
    entry: manualFinalPayFor(workflowId),
    reimbursements: reimbursementConfirmationFor(workflowId),
    /** Finance can record (or correct) the reimbursements while the step is waiting on Finance. */
    canConfirmReimbursements: !!approvalAwaiting(workflowId, STEP_KEY) && !!getSettlementStatement(workflowId),
    /** Finance can enter (or correct) a figure only while payroll can't produce one. */
    canEnter: finalPay.source !== 'payroll' && !!approvalAwaiting(workflowId, STEP_KEY) && !!getSettlementStatement(workflowId),
  }
}

export async function enterFinalPay(
  workflowId: string,
  userId: string,
  input: { amount: unknown; currency: unknown; note: unknown },
  options: RecordOptions = {},
): Promise<{ ok: true; rerun: RerunOutcome } | { ok: false; error: FinalPayError; message?: string }> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaiting(workflowId, STEP_KEY)
  if (!approval) return { ok: false, error: 'not_awaiting_finance' }
  // The assigned Finance approver, or the Finance head.
  const head = departmentHead(stepOf(ctx, STEP_KEY)!.departmentName)
  if (approval.approverId && approval.approverId !== userId && head?.id !== userId) return { ok: false, error: 'not_allowed' }

  if (computeSettlement(ctx, exitDetailsFor(ctx)).finalPay.source === 'payroll') return { ok: false, error: 'already_calculated' }
  const statement = getSettlementStatement(workflowId)
  if (!statement) return { ok: false, error: 'no_statement' }

  const amount = typeof input.amount === 'number' ? input.amount : typeof input.amount === 'string' ? Number(input.amount.trim()) : NaN
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) return { ok: false, error: 'invalid_input', message: 'Enter the final pay as a non-negative amount' }
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'invalid_input', message: 'Enter a 3-letter currency code, e.g. USD' }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().replace(/\s+/g, ' ').slice(0, 300) : null

  const entry: ManualFinalPay = {
    amount: Math.round(amount * 100) / 100,
    currency,
    note,
    enteredBy: userId,
    enteredByName: getUserById(userId)?.name ?? 'Finance',
    enteredAt: new Date().toISOString(),
  }
  runInTransaction(() => {
    upsertSettlementStatement(workflowId, { ...statement.statement, manualFinalPay: entry })
    recordWorkflowEvent({ workflowId, stepKey: STEP_KEY, action: 'final_pay_entered', detail: { amount: entry.amount, currency, note }, performedBy: userId })
    notifyRoleAbout('HR', approval.id, `Finance entered the final pay for ${ctx.name}: ${currency} ${entry.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  })
  return { ok: true, rerun: await rerunAfter(workflowId, STEP_KEY, userId, options) }
}

export async function confirmReimbursements(
  workflowId: string,
  userId: string,
  input: { outstanding: unknown; amount: unknown; currency: unknown; note: unknown },
  options: RecordOptions = {},
): Promise<{ ok: true; rerun: RerunOutcome } | { ok: false; error: FinalPayError; message?: string }> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaiting(workflowId, STEP_KEY)
  if (!approval) return { ok: false, error: 'not_awaiting_finance' }
  const head = departmentHead(stepOf(ctx, STEP_KEY)!.departmentName)
  if (approval.approverId && approval.approverId !== userId && head?.id !== userId) return { ok: false, error: 'not_allowed' }
  const statement = getSettlementStatement(workflowId)
  if (!statement) return { ok: false, error: 'no_statement' }

  if (typeof input.outstanding !== 'boolean') return { ok: false, error: 'invalid_input', message: 'Say whether any reimbursements are outstanding' }
  const outstanding = input.outstanding
  let amount: number | null = null
  let currency: string | null = null
  if (outstanding) {
    const n = typeof input.amount === 'number' ? input.amount : typeof input.amount === 'string' ? Number(input.amount.trim()) : NaN
    if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return { ok: false, error: 'invalid_input', message: 'Enter the outstanding reimbursements as a positive amount' }
    const c = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : ''
    if (!/^[A-Z]{3}$/.test(c)) return { ok: false, error: 'invalid_input', message: 'Enter a 3-letter currency code, e.g. USD' }
    amount = Math.round(n * 100) / 100
    currency = c
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().replace(/\s+/g, ' ').slice(0, 300) : null

  const confirmation: ReimbursementConfirmation = {
    outstanding,
    amount,
    currency,
    note,
    confirmedBy: userId,
    confirmedByName: getUserById(userId)?.name ?? 'Finance',
    confirmedAt: new Date().toISOString(),
  }
  const summary = outstanding ? `${currency} ${amount!.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding` : 'none outstanding'
  runInTransaction(() => {
    upsertSettlementStatement(workflowId, { ...statement.statement, reimbursementConfirmation: confirmation })
    recordWorkflowEvent({ workflowId, stepKey: STEP_KEY, action: 'reimbursements_confirmed', detail: { outstanding, amount, currency, note }, performedBy: userId })
    notifyRoleAbout('HR', approval.id, `Finance confirmed the pending reimbursements for ${ctx.name}: ${summary}`)
  })
  return { ok: true, rerun: await rerunAfter(workflowId, STEP_KEY, userId, options) }
}

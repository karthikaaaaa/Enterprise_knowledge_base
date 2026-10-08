import {
  getWorkflow,
  getEmployeeById,
  runInTransaction,
  createExpenseAccount,
  getExpenseAccountByWorkflow,
  createFinanceSignoffRecord,
  getFinanceSignoffRecordByWorkflow,
  type ExpenseAccount,
  type FinanceSignoffRecord,
} from '@/lib/workflow-store'
import { compileFinanceVerificationSource } from '@/lib/workflow-actions'
import {
  approvalAwaiting,
  latestRunIdFor,
  notifyRoleAbout,
  rerunAfter,
  type RecordOptions,
  type RerunOutcome,
} from '@/lib/structured-review'
import {
  buildFinanceFacts,
  EXPENSE_DRAFTED_ISSUE,
  SIGNOFF_READY_ISSUE,
  type FinanceVerificationSource,
} from '@/lib/finance-verification-log'
import { maskSensitive } from '@/lib/info-request-items'

/**
 * Records finance_verification creates (alongside the payroll entry in lib/payroll.ts): the expense
 * account and the Finance sign-off pack. Same pattern for all three — drafted entirely from verified
 * records (nothing generated or guessed), created when Finance confirms, then the finance AI review
 * re-runs so the matching task flips to "done" citing the new record. Reverting finance_verification
 * deletes all of them (deleteFinanceVerificationArtifactsForWorkflow).
 */

export type FinanceRecordOptions = RecordOptions
export type { RerunOutcome }

/** The finance approval, only while it's still waiting on Finance (not completed/verified). */
export function approvalAwaitingFinance(workflowId: string) {
  return approvalAwaiting(workflowId, 'finance_verification')
}

export function latestRunId(approvalId: string) {
  return latestRunIdFor(approvalId, 'finance_verification')
}

export function notifyHr(approvalId: string, message: string) {
  notifyRoleAbout('HR', approvalId, message)
}

export function rerunAfterCreate(workflowId: string, userId: string, options: FinanceRecordOptions) {
  return rerunAfter(workflowId, 'finance_verification', userId, options)
}

// ---------- Expense account ----------

export type ExpenseAccountDraft = {
  ready: boolean
  blockers: string[]
  fields: {
    holderName: string
    contactEmail: string
    costCenter: string
    approverName: string | null
    sourceSubmissionId: string
  } | null
  reimbursement: { ref: string; masked: string } | null
}

/** Pure. `approverName` is the employee's manager from the employees table (null if none). */
export function buildExpenseAccountDraft(source: FinanceVerificationSource, approverName: string | null): ExpenseAccountDraft {
  const task = buildFinanceFacts(source).tasks.find((t) => t.id === 'expense_account')!
  const blockers = task.issues.filter((issue) => issue !== EXPENSE_DRAFTED_ISSUE)
  const submission = source.submission
  const bank = source.financeDetails?.bankAccountNumber
  if (!submission) blockers.unshift('No employee detail submission is on file.')
  return {
    ready: blockers.length === 0 && !!submission?.email && !!bank,
    blockers,
    fields: submission
      ? {
          holderName: submission.fullName,
          contactEmail: submission.email,
          costCenter: submission.department,
          approverName,
          sourceSubmissionId: submission.id,
        }
      : null,
    reimbursement: bank ? { ref: bank.recordId, masked: maskSensitive(bank.value) } : null,
  }
}

function managerName(workflowId: string): string | null {
  const workflow = getWorkflow(workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  const manager = employee?.managerId ? getEmployeeById(employee.managerId) : null
  return manager ? `${manager.firstName} ${manager.lastName}` : null
}

export function getExpenseAccountDraft(workflowId: string) {
  return {
    draft: buildExpenseAccountDraft(compileFinanceVerificationSource(workflowId), managerName(workflowId)),
    record: getExpenseAccountByWorkflow(workflowId),
  }
}

export type CreateFinanceRecordError = 'workflow_not_found' | 'not_awaiting_finance' | 'already_created' | 'not_ready'

export async function createExpenseAccountFromDraft(
  workflowId: string,
  createdByUserId: string,
  options: FinanceRecordOptions = {},
): Promise<
  { ok: true; record: ExpenseAccount; rerun: RerunOutcome } | { ok: false; error: CreateFinanceRecordError; message?: string }
> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaitingFinance(workflowId)
  if (!approval) return { ok: false, error: 'not_awaiting_finance' }
  if (getExpenseAccountByWorkflow(workflowId)) return { ok: false, error: 'already_created' }

  const { draft } = getExpenseAccountDraft(workflowId)
  if (!draft.ready || !draft.fields || !draft.reimbursement) {
    return { ok: false, error: 'not_ready', message: draft.blockers.join(' ') }
  }
  const { fields, reimbursement } = draft
  const record = runInTransaction(() => {
    const created = createExpenseAccount({
      workflowId,
      employeeId: workflow.employeeId,
      holderName: fields.holderName,
      contactEmail: fields.contactEmail,
      costCenter: fields.costCenter,
      approverName: fields.approverName,
      reimbursementBankRef: reimbursement.ref,
      sourceRunId: latestRunId(approval.id),
      createdBy: createdByUserId,
    })
    notifyHr(approval.id, `Expense account created for ${fields.holderName}`)
    return created
  })
  return { ok: true, record, rerun: await rerunAfterCreate(workflowId, createdByUserId, options) }
}

// ---------- Finance sign-off pack ----------

export type SignoffPackDraft = {
  ready: boolean
  blockers: string[]
  /** The record ids Finance is signing off on — exactly what gets stored. */
  snapshot: Record<string, string | null>
}

/** Pure: ready only once bank/tax, payroll and expense are all done, the HR profile exists and the
 * document cross-check matched — i.e. the sign-off task's only remaining issue is the pack itself. */
export function buildSignoffPackDraft(source: FinanceVerificationSource): SignoffPackDraft {
  const task = buildFinanceFacts(source).tasks.find((t) => t.id === 'finance_signoff')!
  const blockers = task.issues.filter((issue) => issue !== SIGNOFF_READY_ISSUE)
  return {
    ready: blockers.length === 0 && !!source.payrollRecord && !!source.expenseAccount,
    blockers,
    snapshot: {
      payrollRecordId: source.payrollRecord?.id ?? null,
      expenseAccountId: source.expenseAccount?.id ?? null,
      bankDetailsRef: source.financeDetails?.bankAccountNumber?.recordId ?? null,
      taxDetailsRef: source.financeDetails?.taxId?.recordId ?? null,
      documentCheckId: source.documentCheck?.id ?? null,
      documentCheckStatus: source.documentCheck?.overallStatus ?? null,
      hrProfileEntryId: source.hrProfileEntryId,
      submissionId: source.submission?.id ?? null,
    },
  }
}

export function getSignoffPackDraft(workflowId: string) {
  return {
    draft: buildSignoffPackDraft(compileFinanceVerificationSource(workflowId)),
    record: getFinanceSignoffRecordByWorkflow(workflowId),
  }
}

export async function createSignoffPackFromDraft(
  workflowId: string,
  createdByUserId: string,
  options: FinanceRecordOptions = {},
): Promise<
  { ok: true; record: FinanceSignoffRecord; rerun: RerunOutcome } | { ok: false; error: CreateFinanceRecordError; message?: string }
> {
  if (!getWorkflow(workflowId)) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaitingFinance(workflowId)
  if (!approval) return { ok: false, error: 'not_awaiting_finance' }
  if (getFinanceSignoffRecordByWorkflow(workflowId)) return { ok: false, error: 'already_created' }

  const { draft } = getSignoffPackDraft(workflowId)
  if (!draft.ready) return { ok: false, error: 'not_ready', message: draft.blockers.join(' ') }

  const record = runInTransaction(() => {
    const created = createFinanceSignoffRecord({
      workflowId,
      snapshot: draft.snapshot,
      sourceRunId: latestRunId(approval.id),
      createdBy: createdByUserId,
    })
    notifyHr(approval.id, `Finance sign-off pack created — ready for Finance to verify`)
    return created
  })
  return { ok: true, record, rerun: await rerunAfterCreate(workflowId, createdByUserId, options) }
}

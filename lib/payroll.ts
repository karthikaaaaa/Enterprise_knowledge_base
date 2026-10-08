import {
  getWorkflow,
  createPayrollRecord,
  getPayrollRecordByWorkflow,
  runInTransaction,
  type PayFrequency,
  type PayrollRecord,
} from '@/lib/workflow-store'
import { compileFinanceVerificationSource } from '@/lib/workflow-actions'
import { buildFinanceFacts, type FinanceVerificationSource } from '@/lib/finance-verification-log'
import { maskSensitive } from '@/lib/info-request-items'
import {
  approvalAwaitingFinance,
  latestRunId,
  notifyHr,
  rerunAfterCreate,
  type FinanceRecordOptions,
  type RerunOutcome,
} from '@/lib/finance-records'

/**
 * Payroll entry creation for finance_verification. The entry is drafted entirely from verified
 * records (submission fields that passed the offer-letter / employee-record cross-checks, plus the
 * bank/tax details the employee submitted) — nothing is generated or guessed. The only thing no
 * record holds is compensation, so Finance supplies it when confirming. Creating the entry
 * re-runs the finance AI review so the Payroll task flips to "done" with the new record as evidence.
 */

export const PAY_FREQUENCIES: readonly PayFrequency[] = ['monthly', 'semi_monthly', 'biweekly', 'weekly']
const MAX_ANNUAL_SALARY = 100_000_000

export type PayrollDraft = {
  ready: boolean
  blockers: string[]
  fields: { legalName: string; roleTitle: string; department: string; startDate: string; sourceSubmissionId: string } | null
  /** References only — values are masked; the full numbers stay in employee_finance_details. */
  bank: { ref: string; masked: string } | null
  tax: { ref: string; masked: string } | null
}

/** Pure: what the payroll entry would contain, and what (if anything) stops it being created. */
export function buildPayrollDraft(source: FinanceVerificationSource): PayrollDraft {
  const blockers: string[] = []
  const payrollTask = buildFinanceFacts(source).tasks.find((t) => t.id === 'payroll_entry')!
  if (payrollTask.status === 'failed') {
    // Its issues already say exactly what's missing or mismatched (name, start date, offer letter...).
    blockers.push(...payrollTask.issues.filter((issue) => !issue.startsWith('The payroll entry')))
  }
  const bank = source.financeDetails?.bankAccountNumber
  const tax = source.financeDetails?.taxId
  if (!bank) blockers.push('Bank account details are not on file — request them from the employee.')
  if (!tax) blockers.push('Tax ID is not on file — request it from the employee.')

  const submission = source.submission
  return {
    ready: blockers.length === 0,
    blockers,
    fields: submission
      ? {
          legalName: submission.fullName,
          roleTitle: submission.roleTitle,
          department: submission.department,
          startDate: submission.startDate,
          sourceSubmissionId: submission.id,
        }
      : null,
    bank: bank ? { ref: bank.recordId, masked: maskSensitive(bank.value) } : null,
    tax: tax ? { ref: tax.recordId, masked: maskSensitive(tax.value) } : null,
  }
}

export function getPayrollDraft(workflowId: string): { draft: PayrollDraft; record: PayrollRecord | null } {
  return {
    draft: buildPayrollDraft(compileFinanceVerificationSource(workflowId)),
    record: getPayrollRecordByWorkflow(workflowId),
  }
}

export type CreatePayrollError = 'workflow_not_found' | 'not_awaiting_finance' | 'already_created' | 'not_ready' | 'invalid_input'

export type CreatePayrollInput = { annualSalary: unknown; currency: unknown; payFrequency: unknown }

export async function createPayrollEntry(
  workflowId: string,
  createdByUserId: string,
  input: CreatePayrollInput,
  options: FinanceRecordOptions = {},
): Promise<
  | { ok: true; record: PayrollRecord; rerun: RerunOutcome }
  | { ok: false; error: CreatePayrollError; message?: string }
> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaitingFinance(workflowId)
  if (!approval) return { ok: false, error: 'not_awaiting_finance' }
  if (getPayrollRecordByWorkflow(workflowId)) return { ok: false, error: 'already_created' }

  const draft = buildPayrollDraft(compileFinanceVerificationSource(workflowId))
  if (!draft.ready || !draft.fields || !draft.bank || !draft.tax) {
    return { ok: false, error: 'not_ready', message: draft.blockers.join(' ') }
  }

  const annualSalary = typeof input.annualSalary === 'number' ? input.annualSalary : Number(input.annualSalary)
  if (!Number.isFinite(annualSalary) || annualSalary <= 0 || annualSalary > MAX_ANNUAL_SALARY) {
    return { ok: false, error: 'invalid_input', message: 'Enter an annual salary greater than 0' }
  }
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'invalid_input', message: 'Currency must be a 3-letter code, e.g. USD' }
  if (!PAY_FREQUENCIES.includes(input.payFrequency as PayFrequency)) {
    return { ok: false, error: 'invalid_input', message: 'Choose a pay frequency' }
  }

  const { fields, bank, tax } = draft
  const record = runInTransaction(() => {
    const created = createPayrollRecord({
      workflowId,
      employeeId: workflow.employeeId,
      legalName: fields.legalName,
      roleTitle: fields.roleTitle,
      department: fields.department,
      startDate: fields.startDate,
      payFrequency: input.payFrequency as PayFrequency,
      annualSalary: Math.round(annualSalary * 100) / 100,
      currency,
      bankDetailsRef: bank.ref,
      taxDetailsRef: tax.ref,
      sourceRunId: latestRunId(approval.id),
      createdBy: createdByUserId,
    })
    notifyHr(approval.id, `Payroll entry created for ${fields.legalName}`)
    return created
  })
  return { ok: true, record, rerun: await rerunAfterCreate(workflowId, createdByUserId, options) }
}

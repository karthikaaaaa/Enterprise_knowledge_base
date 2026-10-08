import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import { FINANCE_TASK_IDS } from '@/lib/finance-verification-log'
import * as store from '@/lib/workflow-store'
import { compileFinanceVerificationSource, rerunFinanceVerification } from '@/lib/workflow-actions'
import { createPayrollEntry } from '@/lib/payroll'
import {
  buildExpenseAccountDraft,
  buildSignoffPackDraft,
  createExpenseAccountFromDraft,
  createSignoffPackFromDraft,
} from '@/lib/finance-records'
import { verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { requestEmployeeInfo, submitEmployeeInfo } from '@/lib/employee-info-requests'
import { revertStep } from '@/lib/workflow-revert'
import { onboardingSteps } from './helpers'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: FINANCE_TASK_IDS.map((id) => ({ id, recommendation: 'Stub.' })) }),
  model: 'stub-model',
})

type Log = { overallStatus: string; tasks: { id: string; status: string; evidence: { type: string; source: string }[] }[] }

function latestLog(approvalId: string): Log {
  return store.listAiVerificationRuns(approvalId, 'finance_verification')[0].result as Log
}

describe('expense account, sign-off pack, and revert', () => {
  let workflowId: string
  let financeStepId: string
  let hrId: string
  let financeId: string
  let employeeUserId: string
  let approvalId: string

  before(async () => {
    const hrRole = store.getOrCreateRole('HR')
    const financeRole = store.getOrCreateRole('Finance')
    const employeeRole = store.getOrCreateRole('Employee')
    hrId = store.createUser({ name: 'Rec HR', email: 'rec-hr@test.local', hashedPassword: 'x', roleId: hrRole.id }).id
    financeId = store.createUser({ name: 'Rec Finance', email: 'rec-fin@test.local', hashedPassword: 'x', roleId: financeRole.id }).id
    const managerUser = store.createUser({ name: 'Mary Jackson', email: 'mary@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    const empUser = store.createUser({ name: 'Dorothy Vaughan', email: 'dorothy@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    employeeUserId = empUser.id
    const manager = store.createEmployee({ userId: managerUser.id, empCode: 'EMP-MGR', firstName: 'Mary', lastName: 'Jackson' })
    const employee = store.createEmployee({
      userId: empUser.id,
      empCode: 'EMP-REC',
      firstName: 'Dorothy',
      lastName: 'Vaughan',
      managerId: manager.id,
      dateOfJoining: '2026-06-01',
    })
    const { details, finance } = onboardingSteps()
    financeStepId = finance.id
    workflowId = store.createWorkflow({ employeeId: employee.id, type: 'onboarding', status: 'in_progress', currentStepId: finance.id }).id
    store.createEmployeeDetailSubmission({
      workflowId,
      employeeId: employee.id,
      fullName: 'Dorothy Vaughan',
      email: 'dorothy@example.com',
      phone: '+1 555 0177',
      roleTitle: 'Programmer',
      department: 'Computing',
      startDate: '2026-06-01',
      submittedBy: empUser.id,
    })
    store.createEmployeeDocument({
      workflowId,
      employeeId: employee.id,
      documentType: 'offer_letter',
      fileName: 'dv-offer.pdf',
      fileMimeType: 'application/pdf',
      fileData: Buffer.from('%PDF').toString('base64'),
      extractedFields: { fullName: 'Dorothy Vaughan', startDate: '2026-06-01' },
      uploadedBy: empUser.id,
    })
    store.createDocumentVerificationResult({ workflowId, stepId: details.id, overallStatus: 'match', summary: 'ok', details: [], runBy: hrId })
    store.createHrApprovalProfileEntry({
      workflowId,
      stepId: details.id,
      markdown: '# Dorothy',
      summary: 'Profile',
      documentId: 'doc-test',
      documentName: 'Dorothy profile',
      generatedBy: hrId,
    })
    store.createApproval({ workflowId, stepId: details.id, status: 'verified', verifiedBy: hrId, verifiedAt: new Date().toISOString() })
    approvalId = store.createApproval({ workflowId, stepId: finance.id, approverId: financeId, status: 'allocated' }).id
    await rerunFinanceVerification(workflowId, financeId, stub)
  })

  test('expense account and sign-off pack are blocked until their prerequisites exist', async () => {
    const source = compileFinanceVerificationSource(workflowId)
    const expense = buildExpenseAccountDraft(source, 'Mary Jackson')
    assert.equal(expense.ready, false)
    assert.ok(expense.blockers.some((b) => b.includes('reimbursements')))
    assert.equal((await createExpenseAccountFromDraft(workflowId, financeId, { generate: stub })).ok, false)

    const signoff = buildSignoffPackDraft(source)
    assert.equal(signoff.ready, false)
    assert.equal((await createSignoffPackFromDraft(workflowId, financeId, { generate: stub })).ok, false)
  })

  test('the full finance flow ends in a "ready" run that verifies without a flagged-issues review', async () => {
    const request = requestEmployeeInfo(workflowId, hrId, { items: ['bank_details', 'tax_id'] })
    assert.ok(request.ok)
    const submitted = await submitEmployeeInfo(
      workflowId,
      request.ok ? request.request.id : '',
      employeeUserId,
      { fields: { accountHolder: 'Dorothy Vaughan', bankAccountNumber: '99887766554433', bankRoutingCode: '021000021', taxId: 'TAX-77889' } },
      { generate: stub },
    )
    assert.ok(submitted.ok)

    // Expense account: drafted entirely from records, manager as approver.
    const expenseDraft = buildExpenseAccountDraft(compileFinanceVerificationSource(workflowId), 'Mary Jackson')
    assert.equal(expenseDraft.ready, true)
    assert.equal(expenseDraft.fields?.costCenter, 'Computing')
    assert.equal(expenseDraft.reimbursement?.masked, '••••4433')
    const expense = await createExpenseAccountFromDraft(workflowId, financeId, { generate: stub })
    assert.ok(expense.ok)
    assert.equal(expense.ok && expense.record.approverName, 'Mary Jackson')
    let log = latestLog(approvalId)
    const expenseTask = log.tasks.find((t) => t.id === 'expense_account')!
    assert.equal(expenseTask.status, 'done')
    assert.ok(expenseTask.evidence.some((e) => e.type === 'record_created' && e.source === `expense_accounts/${expense.ok && expense.record.id}`))

    // Sign-off pack still blocked: payroll isn't created yet.
    assert.equal(buildSignoffPackDraft(compileFinanceVerificationSource(workflowId)).ready, false)
    assert.ok((await createPayrollEntry(workflowId, financeId, { annualSalary: 64000, currency: 'USD', payFrequency: 'biweekly' }, { generate: stub })).ok)

    const signoffDraft = buildSignoffPackDraft(compileFinanceVerificationSource(workflowId))
    assert.equal(signoffDraft.ready, true, signoffDraft.blockers.join(' | '))
    const signoff = await createSignoffPackFromDraft(workflowId, financeId, { generate: stub })
    assert.ok(signoff.ok)
    assert.equal(signoff.ok && signoff.record.snapshot.payrollRecordId, store.getPayrollRecordByWorkflow(workflowId)?.id)

    log = latestLog(approvalId)
    assert.deepEqual(
      log.tasks.map((t) => [t.id, t.status]),
      FINANCE_TASK_IDS.map((id) => [id, 'done']),
    )
    assert.equal(log.overallStatus, 'ready')

    // Ready runs verify outright — no acknowledgement or comment needed.
    assert.deepEqual(verifyDepartmentSummaryStep(approvalId, financeId), { ok: true, approvalStatus: 'completed' })
  })

  test('creating anything after Finance has verified is refused', async () => {
    const again = await createSignoffPackFromDraft(workflowId, financeId, { generate: stub })
    assert.equal(!again.ok && again.error, 'not_awaiting_finance')
  })

  test('HR revert of Finance Verification wipes every finance record so it can be redone', async () => {
    const result = await revertStep(workflowId, financeStepId, hrId)
    assert.ok(result.ok, JSON.stringify(result))

    assert.equal(store.getPayrollRecordByWorkflow(workflowId), null)
    assert.equal(store.getExpenseAccountByWorkflow(workflowId), null)
    assert.equal(store.getFinanceSignoffRecordByWorkflow(workflowId), null)
    assert.equal(store.listEmployeeFinanceDetails(workflowId).length, 0)
    assert.equal(store.listEmployeeInfoRequests(workflowId, 'finance_verification').length, 0)
    assert.equal(store.getApproval(approvalId), null)

    // Redo from scratch: a fresh notify-equivalent approval + run starts with nothing on file.
    const redo = store.createApproval({ workflowId, stepId: financeStepId, approverId: financeId, status: 'allocated' })
    await rerunFinanceVerification(workflowId, financeId, stub)
    const log = latestLog(redo.id)
    assert.equal(log.tasks.find((t) => t.id === 'bank_tax_details')!.status, 'failed')
    assert.ok(log.tasks.every((t) => t.evidence.every((e) => e.type !== 'record_created')))
    assert.equal(buildExpenseAccountDraft(compileFinanceVerificationSource(workflowId), null).ready, false)
  })
})

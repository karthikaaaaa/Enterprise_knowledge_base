import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import { FINANCE_TASK_IDS } from '@/lib/finance-verification-log'
import * as store from '@/lib/workflow-store'
import { compileFinanceVerificationSource, rerunFinanceVerification } from '@/lib/workflow-actions'
import { buildPayrollDraft, createPayrollEntry } from '@/lib/payroll'
import { onboardingSteps } from './helpers'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: FINANCE_TASK_IDS.map((id) => ({ id, recommendation: 'Stub.' })) }),
  model: 'stub-model',
})

const valid = { annualSalary: 98765.43, currency: 'gbp', payFrequency: 'monthly' }

describe('payroll entry', () => {
  let workflowId: string
  let financeId: string
  let approvalId: string
  let employeeId: string
  let submissionId: string

  before(async () => {
    const financeRole = store.getOrCreateRole('Finance')
    const employeeRole = store.getOrCreateRole('Employee')
    financeId = store.createUser({ name: 'Pay Finance', email: 'pay-fin@test.local', hashedPassword: 'x', roleId: financeRole.id }).id
    const empUser = store.createUser({ name: 'Katherine Johnson', email: 'kj@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    const employee = store.createEmployee({ userId: empUser.id, empCode: 'EMP-PAY', firstName: 'Katherine', lastName: 'Johnson', dateOfJoining: '2026-05-04' })
    employeeId = employee.id
    const { details, finance } = onboardingSteps()
    workflowId = store.createWorkflow({ employeeId, type: 'onboarding', status: 'in_progress', currentStepId: finance.id }).id
    submissionId = store.createEmployeeDetailSubmission({
      workflowId,
      employeeId,
      fullName: 'Katherine Johnson',
      email: 'kj@example.com',
      phone: '+1 555 0123',
      roleTitle: 'Mathematician',
      department: 'Research',
      startDate: '2026-05-04',
      submittedBy: empUser.id,
    }).id
    store.createEmployeeDocument({
      workflowId,
      employeeId,
      documentType: 'offer_letter',
      fileName: 'kj-offer.pdf',
      fileMimeType: 'application/pdf',
      fileData: Buffer.from('%PDF').toString('base64'),
      extractedFields: { fullName: 'Katherine Johnson', startDate: '2026-05-04' },
      uploadedBy: empUser.id,
    })
    store.createApproval({ workflowId, stepId: details.id, status: 'verified', verifiedBy: financeId, verifiedAt: new Date().toISOString() })
    approvalId = store.createApproval({ workflowId, stepId: finance.id, approverId: financeId, status: 'allocated' }).id
    await rerunFinanceVerification(workflowId, financeId, stub)
  })

  test('cannot be created until bank and tax details are on file', async () => {
    const draft = buildPayrollDraft(compileFinanceVerificationSource(workflowId))
    assert.equal(draft.ready, false)
    assert.ok(draft.blockers.some((b) => b.startsWith('Bank account details')))
    assert.ok(draft.blockers.some((b) => b.startsWith('Tax ID')))
    const result = await createPayrollEntry(workflowId, financeId, valid, { generate: stub })
    assert.equal(!result.ok && result.error, 'not_ready')
    assert.equal(store.getPayrollRecordByWorkflow(workflowId), null)
  })

  test('the draft comes from verified records, with bank/tax only as masked references', () => {
    const details = store.createEmployeeFinanceDetails({
      workflowId,
      employeeId,
      requestId: null,
      accountHolder: 'Katherine Johnson',
      bankAccountNumber: '00112233445566',
      bankRoutingCode: '021000021',
      taxId: '123-45-6789',
      fileName: null,
      fileMimeType: null,
      fileData: null,
      submittedBy: financeId,
    })
    const draft = buildPayrollDraft(compileFinanceVerificationSource(workflowId))
    assert.equal(draft.ready, true)
    assert.deepEqual(draft.fields, {
      legalName: 'Katherine Johnson',
      roleTitle: 'Mathematician',
      department: 'Research',
      startDate: '2026-05-04',
      sourceSubmissionId: submissionId,
    })
    assert.deepEqual(draft.bank, { ref: details.id, masked: '••••5566' })
    assert.deepEqual(draft.tax, { ref: details.id, masked: '••••6789' })
  })

  test('a mismatched offer letter blocks the draft', () => {
    const source = compileFinanceVerificationSource(workflowId)
    source.documents[0].extractedFields = { ...source.documents[0].extractedFields, fullName: 'K. Someone' }
    const draft = buildPayrollDraft(source)
    assert.equal(draft.ready, false)
    assert.ok(draft.blockers.some((b) => b.includes('name on the offer letter')))
  })

  test('rejects invalid compensation input', async () => {
    for (const bad of [
      { ...valid, annualSalary: 0 },
      { ...valid, annualSalary: 'lots' },
      { ...valid, currency: 'US' },
      { ...valid, payFrequency: 'daily' },
    ]) {
      const result = await createPayrollEntry(workflowId, financeId, bad, { generate: stub })
      assert.equal(!result.ok && result.error, 'invalid_input')
    }
    assert.equal(store.getPayrollRecordByWorkflow(workflowId), null)
  })

  test('creates the entry, and the re-run marks Payroll done citing the new record', async () => {
    const result = await createPayrollEntry(workflowId, financeId, valid, { generate: stub })
    assert.ok(result.ok && result.rerun === 'done')
    const record = store.getPayrollRecordByWorkflow(workflowId)!
    assert.equal(record.legalName, 'Katherine Johnson')
    assert.equal(record.startDate, '2026-05-04')
    assert.equal(record.currency, 'GBP')
    assert.equal(record.annualSalary, 98765.43)

    const [run] = store.listAiVerificationRuns(approvalId, 'finance_verification')
    const payroll = (run.result as { tasks: { id: string; status: string; issues: string[]; evidence: { type: string; source: string }[] }[] }).tasks.find(
      (t) => t.id === 'payroll_entry',
    )!
    assert.equal(payroll.status, 'done')
    assert.ok(payroll.evidence.some((e) => e.type === 'record_created' && e.source === `payroll_records/${record.id}`))
    assert.ok(!payroll.issues.some((i) => i.includes('drafted')))
    // Compensation never goes into the AI log.
    assert.ok(!JSON.stringify(run.result).includes('98765'))
  })

  test('only one payroll entry per employee workflow', async () => {
    const again = await createPayrollEntry(workflowId, financeId, valid, { generate: stub })
    assert.equal(!again.ok && again.error, 'already_created')
  })
})

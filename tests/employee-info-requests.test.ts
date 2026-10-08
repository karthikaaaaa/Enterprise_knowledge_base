import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import { FINANCE_TASK_IDS } from '@/lib/finance-verification-log'
import { canRequestFromRun, maskSensitive, requestableItemsFromMissing } from '@/lib/info-request-items'
import * as store from '@/lib/workflow-store'
import { rerunFinanceVerification } from '@/lib/workflow-actions'
import { sendBackDepartmentReview, verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { requestEmployeeInfo, submitEmployeeInfo, getOpenInfoRequest } from '@/lib/employee-info-requests'
import { onboardingSteps } from './helpers'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({
    shortSummary: 'Stub summary.',
    tasks: FINANCE_TASK_IDS.map((id) => ({ id, recommendation: `Stub for ${id}.` })),
  }),
  model: 'stub-model',
})

const ACCOUNT_NUMBER = 'GB29NWBK60161331926819'
const TAX_ID = 'QQ123456C'

describe('request info from employee', () => {
  let workflowId: string
  let approvalId: string
  let hrId: string
  let financeId: string
  let employeeUserId: string
  let otherEmployeeUserId: string

  before(async () => {
    const hrRole = store.getOrCreateRole('HR')
    const financeRole = store.getOrCreateRole('Finance')
    const employeeRole = store.getOrCreateRole('Employee')
    hrId = store.createUser({ name: 'Req HR', email: 'req-hr@test.local', hashedPassword: 'x', roleId: hrRole.id }).id
    financeId = store.createUser({ name: 'Req Finance', email: 'req-fin@test.local', hashedPassword: 'x', roleId: financeRole.id }).id
    const empUser = store.createUser({ name: 'Alan Turing', email: 'alan@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    const otherUser = store.createUser({ name: 'Other Person', email: 'other@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    employeeUserId = empUser.id
    otherEmployeeUserId = otherUser.id

    const employee = store.createEmployee({ userId: empUser.id, empCode: 'EMP-REQ', firstName: 'Alan', lastName: 'Turing', dateOfJoining: '2026-04-01' })
    store.createEmployee({ userId: otherUser.id, empCode: 'EMP-OTHER', firstName: 'Other', lastName: 'Person' })
    const { details, finance } = onboardingSteps()
    workflowId = store.createWorkflow({ employeeId: employee.id, type: 'onboarding', status: 'in_progress', currentStepId: finance.id }).id
    store.createEmployeeDetailSubmission({
      workflowId,
      employeeId: employee.id,
      fullName: 'Alan Turing',
      email: 'alan@example.com',
      phone: '+44 20 0000 0000',
      roleTitle: 'Researcher',
      department: 'R&D',
      startDate: '2026-04-01',
      submittedBy: empUser.id,
    })
    store.createApproval({ workflowId, stepId: details.id, status: 'verified', verifiedBy: hrId, verifiedAt: new Date().toISOString() })
    approvalId = store.createApproval({ workflowId, stepId: finance.id, approverId: financeId, status: 'allocated' }).id
    await rerunFinanceVerification(workflowId, financeId, stub)
  })

  test('masking never reveals more than the last 4 characters', () => {
    assert.equal(maskSensitive(ACCOUNT_NUMBER), '••••6819')
    assert.equal(maskSensitive('12 34-56 78'), '••••5678')
    assert.equal(maskSensitive('1234'), '••••')
  })

  test('HR can request as soon as a run flags employee-providable data, or Finance sent it back — never after verify', () => {
    assert.equal(canRequestFromRun({ missingData: ['Tax ID'], reviewAction: null }), true)
    assert.equal(canRequestFromRun({ missingData: ['Offer letter'], reviewAction: null }), false)
    assert.equal(canRequestFromRun({ missingData: [], reviewAction: 'sent_back' }), true)
    assert.equal(canRequestFromRun({ missingData: ['Tax ID'], reviewAction: 'verified' }), false)
  })

  test('the request pre-fills from missing data and validates items', () => {
    assert.ok(sendBackDepartmentReview(approvalId, financeId, 'No bank or tax details on file').ok)
    const [run] = store.listAiVerificationRuns(approvalId, 'finance_verification')
    const missing = (run.result as { missingData: string[] }).missingData
    assert.deepEqual(requestableItemsFromMissing(missing), ['bank_details', 'tax_id'])

    assert.deepEqual(requestEmployeeInfo(workflowId, hrId, { items: [] }), { ok: false, error: 'invalid_items' })
    assert.deepEqual(requestEmployeeInfo(workflowId, hrId, { items: ['salary'] }), { ok: false, error: 'invalid_items' })
    const created = requestEmployeeInfo(workflowId, hrId, { items: ['bank_details', 'tax_id', 'tax_id'], message: 'Please add these' })
    assert.ok(created.ok)
    assert.deepEqual(created.ok && created.request.requestedItems, ['bank_details', 'tax_id'])
    assert.deepEqual(requestEmployeeInfo(workflowId, hrId, { items: ['tax_id'] }), { ok: false, error: 'request_already_open' })
  })

  test('only the workflow’s own employee can answer, with every requested field valid', async () => {
    const requestId = getOpenInfoRequest(workflowId)!.id
    const valid = { accountHolder: 'Alan Turing', bankAccountNumber: ACCOUNT_NUMBER, bankRoutingCode: '601613', taxId: TAX_ID }

    assert.equal((await submitEmployeeInfo(workflowId, requestId, otherEmployeeUserId, { fields: valid }, { generate: stub })).ok, false)
    assert.deepEqual(await submitEmployeeInfo(workflowId, requestId, hrId, { fields: valid }, { generate: stub }), { ok: false, error: 'forbidden' })

    const missingTax = await submitEmployeeInfo(workflowId, requestId, employeeUserId, { fields: { ...valid, taxId: '' } }, { generate: stub })
    assert.deepEqual(missingTax, { ok: false, error: 'invalid_field', message: 'Tax ID is required' })
    const badAccount = await submitEmployeeInfo(workflowId, requestId, employeeUserId, { fields: { ...valid, bankAccountNumber: '<script>' } }, { generate: stub })
    assert.equal(badAccount.ok, false)
    const badFile = await submitEmployeeInfo(
      workflowId,
      requestId,
      employeeUserId,
      { fields: valid, file: { fileName: 'x.exe', mimeType: 'application/x-msdownload', dataBase64: 'AAAA' } },
      { generate: stub },
    )
    assert.equal(!badFile.ok && badFile.error, 'invalid_file')

    // Nothing was stored by any of the rejected attempts.
    assert.equal(store.listEmployeeFinanceDetails(workflowId).length, 0)
    assert.equal(getOpenInfoRequest(workflowId)?.id, requestId)
  })

  test('a valid answer is stored, closes the request, and re-runs the AI with masked evidence', async () => {
    const requestId = getOpenInfoRequest(workflowId)!.id
    const runsBefore = store.listAiVerificationRuns(approvalId, 'finance_verification').length
    const result = await submitEmployeeInfo(
      workflowId,
      requestId,
      employeeUserId,
      {
        fields: { accountHolder: 'Alan Turing', bankAccountNumber: ACCOUNT_NUMBER, bankRoutingCode: '601613', taxId: TAX_ID },
        file: { fileName: 'bank-letter.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1').toString('base64') },
      },
      { generate: stub },
    )
    assert.ok(result.ok && result.rerun === 'done')

    const request = store.getEmployeeInfoRequest(requestId)!
    assert.equal(request.status, 'fulfilled')
    const [details] = store.listEmployeeFinanceDetails(workflowId)
    assert.equal(request.responseId, details.id)
    assert.equal(details.bankAccountNumber, ACCOUNT_NUMBER)

    const runs = store.listAiVerificationRuns(approvalId, 'finance_verification')
    assert.equal(runs.length, runsBefore + 1)
    const log = runs[0].result as {
      missingData: string[]
      tasks: { id: string; status: string; evidence: { label: string; value: string; source: string; link?: string }[] }[]
    }
    const bankTax = log.tasks.find((t) => t.id === 'bank_tax_details')!
    assert.equal(bankTax.status, 'done')
    assert.ok(!log.missingData.includes('Bank account details') && !log.missingData.includes('Tax ID'))

    const account = bankTax.evidence.find((e) => e.label === 'Bank account number')!
    assert.equal(account.value, '••••6819')
    assert.equal(account.source, `employee_finance_details/${details.id}.bank_account_number`)
    assert.ok(account.link?.endsWith(`/finance-details/${details.id}`))
    assert.equal(bankTax.evidence.find((e) => e.label === 'Tax ID')!.value, '••••456C')

    // The raw numbers never land in the stored run (and so never reach the model or the UI)...
    const stored = JSON.stringify(runs[0].result)
    assert.ok(!stored.includes(ACCOUNT_NUMBER) && !stored.includes(TAX_ID))
    // ...nor in employee_documents, which feeds the document cross-check, Legal and the KB profile.
    assert.equal(store.listEmployeeDocumentsByWorkflow(workflowId).length, 0)
  })

  test('the request can only be answered once, and Finance can verify the fresh run', async () => {
    const [request] = store.listEmployeeInfoRequests(workflowId, 'finance_verification')
    const again = await submitEmployeeInfo(workflowId, request.id, employeeUserId, { fields: {} }, { generate: stub })
    assert.deepEqual(again, { ok: false, error: 'request_not_open' })

    const verified = verifyDepartmentSummaryStep(approvalId, financeId, { acknowledged: true, comment: 'Bank and tax now on file' })
    assert.deepEqual(verified, { ok: true, approvalStatus: 'completed' })
  })
})

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkVerifyGate,
  runAiVerification,
  toHrSummary,
  validateAiVerificationLog,
  validateNarrative,
  FALLBACK_MODEL,
  type NarrativeGenerator,
} from '@/lib/ai-verification-log'
import {
  FINANCE_TASK_IDS,
  FINANCE_VERIFICATION_CONFIG,
  buildFinanceFacts,
  financeDocumentLink,
  resolveFinanceLogView,
  type FinanceVerificationSource,
} from '@/lib/finance-verification-log'
import * as store from '@/lib/workflow-store'
import { compileFinanceVerificationSource, rerunFinanceVerification } from '@/lib/workflow-actions'
import { sendBackDepartmentReview, verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { onboardingSteps } from './helpers'

// ---------- helpers ----------

/** A model stub that returns a valid narrative for every finance task. */
function validReply(summary = 'Stub summary for HR.'): string {
  return JSON.stringify({
    shortSummary: summary,
    tasks: FINANCE_TASK_IDS.map((id) => ({ id, recommendation: `Stub recommendation for ${id}.` })),
  })
}

function stubGenerator(replies: string[]): NarrativeGenerator & { calls: number } {
  const fn = Object.assign(
    async () => {
      const text = replies[Math.min(fn.calls, replies.length - 1)]
      fn.calls++
      return { text, model: 'stub-model' }
    },
    { calls: 0 },
  )
  return fn
}

function fixtureSource(overrides: Partial<FinanceVerificationSource> = {}): FinanceVerificationSource {
  return {
    workflowId: 'wf-fixture',
    employee: { id: 'emp-fixture', name: 'Ada Lovelace', dateOfJoining: '2026-01-05' },
    submission: {
      id: 'empdetail-fixture',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+1 555 0100',
      roleTitle: 'Analyst',
      department: 'Finance',
      startDate: '2026-01-05',
    },
    documents: [
      {
        id: 'empdoc-offer',
        documentType: 'offer_letter',
        fileName: 'offer.pdf',
        extractedFields: { fullName: 'Ada Lovelace', startDate: '2026-01-05' },
      },
    ],
    documentCheck: { id: 'docverify-fixture', overallStatus: 'match' },
    hrProfileEntryId: 'hrprofile-fixture',
    ...overrides,
  }
}

// ---------- schema validation ----------

describe('schema validation', () => {
  test('accepts a well-formed narrative', () => {
    const result = validateNarrative(JSON.parse(validReply()), FINANCE_TASK_IDS)
    assert.equal(result.ok, true)
  })

  test('rejects missing, unknown and duplicate task ids, and an empty summary', () => {
    const missing = validateNarrative({ shortSummary: 'x', tasks: [{ id: 'payroll_entry', recommendation: 'r' }] }, FINANCE_TASK_IDS)
    assert.equal(missing.ok, false)
    assert.ok(!missing.ok && missing.errors.some((e) => e.includes('missing task: bank_tax_details')))

    const reply = JSON.parse(validReply())
    reply.tasks.push({ id: 'made_up_task', recommendation: 'r' }, { id: 'payroll_entry', recommendation: 'again' })
    const extra = validateNarrative(reply, FINANCE_TASK_IDS)
    assert.ok(!extra.ok && extra.errors.some((e) => e.includes('unknown task id')))
    assert.ok(!extra.ok && extra.errors.some((e) => e.includes('duplicate task: payroll_entry')))

    const empty = validateNarrative({ ...JSON.parse(validReply()), shortSummary: '  ' }, FINANCE_TASK_IDS)
    assert.equal(empty.ok, false)
    assert.equal(validateNarrative('not an object', FINANCE_TASK_IDS).ok, false)
  })

  test('a generated log validates against the stored-log schema; a corrupted one does not', async () => {
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), stubGenerator([validReply()]))
    assert.equal(validateAiVerificationLog(log, FINANCE_TASK_IDS).ok, true)
    const corrupted = { ...log, overallStatus: 'fine', tasks: log.tasks.map((t) => ({ ...t, status: 'great' })) }
    assert.equal(validateAiVerificationLog(corrupted, FINANCE_TASK_IDS).ok, false)
  })

  test('retries once on a malformed reply, then uses the valid one', async () => {
    const generate = stubGenerator(['{not json', '```json\n' + validReply('Second attempt.') + '\n```'])
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), generate)
    assert.equal(generate.calls, 2)
    assert.equal(log.model, 'stub-model')
    assert.equal(log.shortSummary, 'Second attempt.')
  })

  test('falls back to deterministic text when the model never returns valid JSON', async () => {
    const generate = stubGenerator(['nope', JSON.stringify({ shortSummary: 'x', tasks: [] })])
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), generate)
    assert.equal(generate.calls, 2)
    assert.equal(log.model, FALLBACK_MODEL)
    assert.ok(log.shortSummary.length > 0)
    assert.equal(validateAiVerificationLog(log, FINANCE_TASK_IDS).ok, true)
  })

  test('does not retry when the model is rate-limited (429) — falls back straight away', async () => {
    let calls = 0
    const rateLimited: NarrativeGenerator = async () => {
      calls++
      throw Object.assign(new Error('429 Rate limit exceeded'), { status: 429 })
    }
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), rateLimited)
    assert.equal(calls, 1)
    assert.equal(log.model, FALLBACK_MODEL)
  })

  test('model text cannot change statuses or evidence', async () => {
    const facts = buildFinanceFacts(fixtureSource())
    const hostile = JSON.stringify({
      shortSummary: 'Everything is done.',
      tasks: FINANCE_TASK_IDS.map((id) => ({ id, recommendation: 'All good', status: 'done', evidence: [] })),
      overallStatus: 'ready',
    })
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), stubGenerator([hostile]))
    assert.deepEqual(
      log.tasks.map((t) => [t.id, t.status, t.evidence]),
      facts.tasks.map((t) => [t.id, t.status, t.evidence]),
    )
    assert.notEqual(log.overallStatus, 'ready')
  })
})

// ---------- missing bank/tax data ----------

describe('missing bank/tax data', () => {
  test('is "failed", never "done", and is listed as missing', () => {
    const facts = buildFinanceFacts(fixtureSource())
    const bankTax = facts.tasks.find((t) => t.id === 'bank_tax_details')!
    assert.equal(bankTax.status, 'failed')
    assert.ok(bankTax.issues.length >= 2)
    assert.ok(facts.missingData.includes('Bank account details'))
    assert.ok(facts.missingData.includes('Tax ID'))
  })

  test('the run is never "ready" while bank/tax data is missing', async () => {
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), stubGenerator([validReply()]))
    assert.equal(log.overallStatus, 'needs_attention')
  })

  test('is "done" only when real bank and tax fields are on file, cited from the document', () => {
    const source = fixtureSource()
    source.documents.push({
      id: 'empdoc-bank',
      documentType: 'bank_form',
      fileName: 'bank.pdf',
      extractedFields: { bankAccountNumber: '12345678', taxId: 'TX-99' },
    })
    const bankTax = buildFinanceFacts(source).tasks.find((t) => t.id === 'bank_tax_details')!
    assert.equal(bankTax.status, 'done')
    assert.deepEqual(
      bankTax.evidence.map((e) => [e.value, e.source]),
      [
        // Sensitive values are masked to the last 4 characters in evidence.
        ['••••5678', 'employee_documents/empdoc-bank.extracted_fields.bankAccountNumber'],
        // "TX-99" is only 4 characters once separators are dropped, so nothing is revealed.
        ['••••', 'employee_documents/empdoc-bank.extracted_fields.taxId'],
      ],
    )
  })

  test('an offer-letter name mismatch fails payroll and blocks the run', () => {
    const source = fixtureSource()
    source.documents[0].extractedFields.fullName = 'Someone Else'
    const facts = buildFinanceFacts(source)
    const payroll = facts.tasks.find((t) => t.id === 'payroll_entry')!
    assert.equal(payroll.status, 'failed')
    assert.ok(payroll.issues.some((i) => i.includes('name on the offer letter')))
  })
})

// ---------- real records (temp database) ----------

describe('evidence from real records + verify gating', () => {
  let workflowId: string
  let financeUserId: string
  let approvalId: string
  let submission: store.EmployeeDetailSubmission
  let offerLetter: store.EmployeeDocument

  before(() => {
    const hrRole = store.getOrCreateRole('HR')
    const financeRole = store.getOrCreateRole('Finance')
    const employeeRole = store.getOrCreateRole('Employee')
    const hr = store.createUser({ name: 'Test HR', email: 'hr@test.local', hashedPassword: 'x', roleId: hrRole.id })
    const finance = store.createUser({ name: 'Test Finance', email: 'fin@test.local', hashedPassword: 'x', roleId: financeRole.id })
    const empUser = store.createUser({ name: 'Grace Hopper', email: 'grace@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    financeUserId = finance.id

    const employee = store.createEmployee({
      userId: empUser.id,
      empCode: 'EMP-T1',
      firstName: 'Grace',
      lastName: 'Hopper',
      dateOfJoining: '2026-03-02',
    })
    const { details: detailsStep, finance: financeStep } = onboardingSteps()
    const workflow = store.createWorkflow({ employeeId: employee.id, type: 'onboarding', status: 'in_progress', currentStepId: financeStep.id })
    workflowId = workflow.id

    submission = store.createEmployeeDetailSubmission({
      workflowId,
      employeeId: employee.id,
      fullName: 'Grace Hopper',
      email: 'grace.hopper@example.com',
      phone: '+1 555 0199',
      roleTitle: 'Engineer',
      department: 'Engineering',
      startDate: '2026-03-02',
      submittedBy: empUser.id,
    })
    offerLetter = store.createEmployeeDocument({
      workflowId,
      employeeId: employee.id,
      documentType: 'offer_letter',
      fileName: 'grace-offer-letter.pdf',
      fileMimeType: 'application/pdf',
      fileData: Buffer.from('%PDF-test').toString('base64'),
      extractedFields: { fullName: 'Grace Hopper', startDate: '2026-03-02' },
      uploadedBy: empUser.id,
    })
    store.createApproval({ workflowId, stepId: detailsStep.id, status: 'verified', verifiedBy: hr.id, verifiedAt: new Date().toISOString() })
    // As Notify would leave it: an allocated finance approval waiting for its AI review.
    approvalId = store.createApproval({ workflowId, stepId: financeStep.id, approverId: finance.id, status: 'allocated' }).id
  })

  test('every evidence value and id comes from the stored records', async () => {
    const result = await rerunFinanceVerification(workflowId, financeUserId, stubGenerator([validReply()]))
    assert.equal(result.ok, true)

    const [run] = store.listAiVerificationRuns(approvalId, 'finance_verification')
    const log = validateAiVerificationLog(run.result, FINANCE_TASK_IDS)
    assert.ok(log.ok)
    const payroll = log.value.tasks.find((t) => t.id === 'payroll_entry')!

    const offer = payroll.evidence.find((e) => e.type === 'document')!
    assert.equal(offer.value, offerLetter.fileName)
    assert.equal(offer.source, `employee_documents/${offerLetter.id}`)
    assert.equal(offer.link, financeDocumentLink(workflowId, offerLetter.id))

    const startDate = payroll.evidence.find((e) => e.label === 'Start date')!
    assert.equal(startDate.value, submission.startDate)
    assert.ok(startDate.source.includes(submission.id))

    const expense = log.value.tasks.find((t) => t.id === 'expense_account')!
    assert.equal(expense.evidence[0].value, submission.email)

    // No payroll/expense records exist in this app, so nothing may claim one was created.
    assert.ok(log.value.tasks.every((t) => t.evidence.every((e) => e.type !== 'record_created')))

    // The old prose field is still populated, from shortSummary.
    assert.equal(store.getLatestStepAiSummary(workflowId, 'finance_verification')?.summaryText, log.value.shortSummary)
  })

  test('compiled source mirrors the database exactly', () => {
    const source = compileFinanceVerificationSource(workflowId)
    assert.equal(source.submission?.id, submission.id)
    assert.deepEqual(source.documents.map((d) => d.id), [offerLetter.id])
    assert.equal(source.documentCheck, null)
  })

  test('re-running keeps history', async () => {
    await rerunFinanceVerification(workflowId, financeUserId, stubGenerator([validReply('Run two.')]))
    const runs = store.listAiVerificationRuns(approvalId, 'finance_verification')
    assert.equal(runs.length, 2)
    assert.equal((runs[0].result as { shortSummary: string }).shortSummary, 'Run two.')
  })

  test('flagged runs need acknowledgement + comment to verify', () => {
    assert.deepEqual(checkVerifyGate('ready', {}), { ok: true })
    assert.deepEqual(checkVerifyGate('needs_attention', {}), { ok: false, reason: 'acknowledgement_required' })
    assert.deepEqual(checkVerifyGate('blocked', { acknowledged: true, comment: '  ' }), { ok: false, reason: 'comment_required' })
    assert.deepEqual(checkVerifyGate('blocked', { acknowledged: true, comment: 'Collected offline' }), { ok: true })
  })

  test('send back requires a comment, and the sent-back run cannot then be verified', () => {
    assert.deepEqual(sendBackDepartmentReview(approvalId, financeUserId, '   '), { ok: false, error: 'comment_required' })
    const sent = sendBackDepartmentReview(approvalId, financeUserId, 'Please collect bank details')
    assert.equal(sent.ok, true)
    const [latest] = store.listAiVerificationRuns(approvalId, 'finance_verification')
    assert.equal(latest.reviewAction, 'sent_back')
    assert.deepEqual(
      verifyDepartmentSummaryStep(approvalId, financeUserId, { acknowledged: true, comment: 'ok' }),
      { ok: false, error: 'rerun_required' },
    )
  })

  test('verify is refused without the review, then succeeds and is recorded on the run', async () => {
    await rerunFinanceVerification(workflowId, financeUserId, stubGenerator([validReply()]))
    assert.deepEqual(verifyDepartmentSummaryStep(approvalId, financeUserId), { ok: false, error: 'review_required' })
    assert.equal(store.getApproval(approvalId)?.status, 'allocated')

    const result = verifyDepartmentSummaryStep(approvalId, financeUserId, { acknowledged: true, comment: 'Bank details collected by email' })
    assert.deepEqual(result, { ok: true, approvalStatus: 'completed' })
    const [latest] = store.listAiVerificationRuns(approvalId, 'finance_verification')
    assert.equal(latest.reviewAction, 'verified')
    assert.equal(latest.reviewComment, 'Bank details collected by email')
    assert.equal(latest.reviewedBy, financeUserId)

    // Once verified, the reviewed run is final.
    const rerun = await rerunFinanceVerification(workflowId, financeUserId, stubGenerator([validReply()]))
    assert.deepEqual(rerun, { ok: false, error: 'already_verified' })
  })
})

// ---------- HR view ----------

describe('HR view', () => {
  test('the HR projection carries the short summary only', async () => {
    const log = await runAiVerification(FINANCE_VERIFICATION_CONFIG, fixtureSource(), stubGenerator([validReply()]))
    const hr = toHrSummary(log)
    assert.deepEqual(Object.keys(hr).sort(), ['generatedAt', 'missingData', 'overallStatus', 'runId', 'shortSummary'])
    assert.equal(hr.shortSummary, log.shortSummary)
    assert.deepEqual(hr.missingData, log.missingData)
  })

  test('HR gets the summary view by default and the full log only on request; employees get nothing', () => {
    assert.equal(resolveFinanceLogView('HR', null), 'summary')
    assert.equal(resolveFinanceLogView('Administrator', null), 'summary')
    assert.equal(resolveFinanceLogView('HR', 'full'), 'full')
    assert.equal(resolveFinanceLogView('Finance', null), 'full')
    assert.equal(resolveFinanceLogView('Employee', 'full'), null)
    assert.equal(resolveFinanceLogView('Legal', null), null)
  })
})

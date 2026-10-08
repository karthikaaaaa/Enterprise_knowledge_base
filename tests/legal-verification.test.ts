import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import { resolveStructuredLogView, validateAiVerificationLog } from '@/lib/ai-verification-log'
import { LEGAL_TASK_IDS, buildLegalFacts, type LegalVerificationSource } from '@/lib/legal-verification-log'
import { CONFIDENTIALITY_AGREEMENT_VERSION } from '@/lib/legal-agreement-template'
import * as store from '@/lib/workflow-store'
import { compileLegalVerificationSource, rerunStructuredReview } from '@/lib/workflow-actions'
import { buildAgreementDraft, createLegalSignoffPack, getAgreementToSign, issueAgreement, signAgreement } from '@/lib/legal-records'
import { sendBackDepartmentReview, verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { revertStep } from '@/lib/workflow-revert'
import { onboardingSteps } from './helpers'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: LEGAL_TASK_IDS.map((id) => ({ id, recommendation: 'Stub.' })) }),
  model: 'stub-model',
})

type Log = { overallStatus: string; missingData: string[]; tasks: { id: string; status: string; issues: string[]; evidence: { type: string; source: string; value: string }[] }[] }

function fixture(overrides: Partial<LegalVerificationSource> = {}): LegalVerificationSource {
  return {
    workflowId: 'wf-legal-fixture',
    employee: { id: 'emp-x', name: 'Ada Lovelace', dateOfJoining: '2026-01-05' },
    submission: { id: 'sub-x', fullName: 'Ada Lovelace', roleTitle: 'Analyst', department: 'Research', startDate: '2026-01-05' },
    documents: [
      { id: 'doc-offer', documentType: 'offer_letter', fileName: 'offer.pdf', extractedFields: { fullName: 'Ada Lovelace', roleTitle: 'Analyst', startDate: '2026-01-05' } },
      { id: 'doc-id', documentType: 'government_id', fileName: 'id.pdf', extractedFields: { fullName: 'Ada Lovelace' } },
    ],
    documentCheck: { id: 'check-x', overallStatus: 'match' },
    agreement: null,
    signoffRecord: null,
    ...overrides,
  }
}

describe('legal facts', () => {
  test('a missing government ID fails identity, blocks the run, and blocks issuing the agreement', () => {
    const source = fixture({ documents: fixture().documents.filter((d) => d.documentType !== 'government_id') })
    const facts = buildLegalFacts(source)
    const identity = facts.tasks.find((t) => t.id === 'identity_document')!
    assert.equal(identity.status, 'failed')
    assert.ok(identity.blocking)
    assert.ok(facts.missingData.includes('Government ID'))
    const draft = buildAgreementDraft(source)
    assert.equal(draft.ready, false)
    assert.ok(draft.blockers.some((b) => b.includes('Identity document')))
  })

  test('an offer letter whose role differs from the profile fails the offer-letter task', () => {
    const source = fixture()
    source.documents[0].extractedFields.roleTitle = 'Senior Analyst'
    const offer = buildLegalFacts(source).tasks.find((t) => t.id === 'offer_letter')!
    assert.equal(offer.status, 'failed')
    assert.ok(offer.issues.some((i) => i.includes('role')))
  })

  test('with verified documents the agreement is drafted from the template and verified fields only', () => {
    const draft = buildAgreementDraft(fixture())
    assert.equal(draft.ready, true)
    assert.equal(draft.preview?.version, CONFIDENTIALITY_AGREEMENT_VERSION)
    assert.ok(draft.preview?.body.includes('Ada Lovelace'))
    assert.ok(draft.preview?.body.includes('Analyst in the Research department with a start date of 2026-01-05'))
  })

  test('Legal sees the full log, HR the summary, and nobody else anything', () => {
    assert.equal(resolveStructuredLogView('Legal', 'Legal', null), 'full')
    assert.equal(resolveStructuredLogView('Legal', 'HR', null), 'summary')
    assert.equal(resolveStructuredLogView('Legal', 'HR', 'full'), 'full')
    assert.equal(resolveStructuredLogView('Legal', 'Finance', 'full'), null)
    assert.equal(resolveStructuredLogView('Legal', 'Employee', null), null)
  })
})

describe('legal verification end to end', () => {
  let workflowId: string
  let legalStepId: string
  let hrId: string
  let legalId: string
  let employeeUserId: string
  let otherEmployeeUserId: string
  let approvalId: string

  const latestLog = () => store.listAiVerificationRuns(approvalId, 'legal_verification')[0].result as Log

  before(async () => {
    const hrRole = store.getOrCreateRole('HR')
    const legalRole = store.getOrCreateRole('Legal')
    const employeeRole = store.getOrCreateRole('Employee')
    hrId = store.createUser({ name: 'Legal HR', email: 'legal-hr@test.local', hashedPassword: 'x', roleId: hrRole.id }).id
    legalId = store.createUser({ name: 'Test Counsel', email: 'counsel@test.local', hashedPassword: 'x', roleId: legalRole.id }).id
    const empUser = store.createUser({ name: 'Annie Easley', email: 'annie@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    const otherUser = store.createUser({ name: 'Not Annie', email: 'notannie@test.local', hashedPassword: 'x', roleId: employeeRole.id })
    employeeUserId = empUser.id
    otherEmployeeUserId = otherUser.id
    const employee = store.createEmployee({ userId: empUser.id, empCode: 'EMP-LEG', firstName: 'Annie', lastName: 'Easley', dateOfJoining: '2026-07-01' })
    store.createEmployee({ userId: otherUser.id, empCode: 'EMP-NOT', firstName: 'Not', lastName: 'Annie' })

    const { details, finance, legal } = onboardingSteps()
    legalStepId = legal.id
    workflowId = store.createWorkflow({ employeeId: employee.id, type: 'onboarding', status: 'in_progress', currentStepId: legal.id }).id
    store.createEmployeeDetailSubmission({
      workflowId,
      employeeId: employee.id,
      fullName: 'Annie Easley',
      email: 'annie@example.com',
      phone: '+1 555 0144',
      roleTitle: 'Engineer',
      department: 'Propulsion',
      startDate: '2026-07-01',
      submittedBy: empUser.id,
    })
    for (const [documentType, fields] of [
      ['offer_letter', { fullName: 'Annie Easley', roleTitle: 'Engineer', startDate: '2026-07-01' }],
      ['government_id', { fullName: 'Annie Easley' }],
    ] as const) {
      store.createEmployeeDocument({
        workflowId,
        employeeId: employee.id,
        documentType,
        fileName: `${documentType}.pdf`,
        fileMimeType: 'application/pdf',
        fileData: Buffer.from('%PDF').toString('base64'),
        extractedFields: fields,
        uploadedBy: empUser.id,
      })
    }
    store.createDocumentVerificationResult({ workflowId, stepId: details.id, overallStatus: 'match', summary: 'ok', details: [], runBy: hrId })
    for (const step of [details, finance]) {
      store.createApproval({ workflowId, stepId: step.id, status: 'verified', verifiedBy: hrId, verifiedAt: new Date().toISOString() })
    }
    approvalId = store.createApproval({ workflowId, stepId: legal.id, approverId: legalId, status: 'allocated' }).id
    // Required by the department Verify (completeAiSummaryStep) — Notify always writes one.
    const run = await rerunStructuredReview(workflowId, 'legal_verification', legalId, stub)
    assert.ok(run.ok)
  })

  test('the first run verifies documents and drafts the agreement, with evidence from real records', () => {
    const log = latestLog()
    assert.ok(validateAiVerificationLog(log, LEGAL_TASK_IDS).ok)
    assert.deepEqual(
      log.tasks.map((t) => [t.id, t.status]),
      [
        ['offer_letter', 'done'],
        ['identity_document', 'done'],
        ['confidentiality_agreement', 'warning'],
        ['legal_signoff', 'warning'],
      ],
    )
    const offerDoc = store.listEmployeeDocumentsByWorkflow(workflowId).find((d) => d.documentType === 'offer_letter')!
    const offerTask = log.tasks.find((t) => t.id === 'offer_letter')!
    assert.ok(offerTask.evidence.some((e) => e.type === 'document' && e.source === `employee_documents/${offerDoc.id}`))
    assert.ok(log.missingData.includes('Signed confidentiality agreement'))
  })

  test('Legal issues the agreement; only the employee can sign, with their exact legal name and consent', async () => {
    const issued = await issueAgreement(workflowId, legalId, { generate: stub })
    assert.ok(issued.ok)
    const agreement = issued.ok ? issued.record : null
    assert.equal(getAgreementToSign(workflowId)?.id, agreement?.id)
    assert.equal((await issueAgreement(workflowId, legalId, { generate: stub })).ok, false)

    const id = agreement!.id
    const sign = (userId: string, signedName: unknown, consent: unknown) => signAgreement(workflowId, id, userId, { signedName, consent }, { generate: stub })
    assert.deepEqual(await sign(legalId, 'Annie Easley', true), { ok: false, error: 'forbidden' })
    assert.deepEqual(await sign(otherEmployeeUserId, 'Annie Easley', true), { ok: false, error: 'forbidden' })
    assert.deepEqual(await sign(employeeUserId, 'Annie Easley', false), { ok: false, error: 'consent_required' })
    assert.deepEqual(await sign(employeeUserId, 'A. Easley', true), { ok: false, error: 'name_mismatch' })
    assert.equal(latestLog().tasks.find((t) => t.id === 'confidentiality_agreement')!.status, 'warning')

    const signed = await sign(employeeUserId, '  annie   EASLEY ', true)
    assert.ok(signed.ok)
    assert.deepEqual(await sign(employeeUserId, 'Annie Easley', true), { ok: false, error: 'already_signed' })
    assert.equal(getAgreementToSign(workflowId), null)

    const agreementTask = latestLog().tasks.find((t) => t.id === 'confidentiality_agreement')!
    assert.equal(agreementTask.status, 'done')
    assert.ok(agreementTask.evidence.some((e) => e.type === 'record_created' && e.source === `legal_agreements/${id}`))
  })

  test('send back and gating work the same as Finance', () => {
    assert.deepEqual(verifyDepartmentSummaryStep(approvalId, legalId), { ok: false, error: 'review_required' })
    assert.equal(sendBackDepartmentReview(approvalId, legalId, '').ok, false)
  })

  test('the compliance pack makes the run "ready" and Legal verifies without a flagged-issues review', async () => {
    const pack = await createLegalSignoffPack(workflowId, legalId, { generate: stub })
    assert.ok(pack.ok)
    assert.equal(pack.ok && pack.record.snapshot.agreementId, store.getLegalAgreementByWorkflow(workflowId)?.id)
    const log = latestLog()
    assert.deepEqual(log.tasks.map((t) => t.status), ['done', 'done', 'done', 'done'])
    assert.equal(log.overallStatus, 'ready')
    assert.deepEqual(verifyDepartmentSummaryStep(approvalId, legalId), { ok: true, approvalStatus: 'completed' })
  })

  test('HR revert of Legal Verification wipes the agreement and pack so it can be redone', async () => {
    const result = await revertStep(workflowId, legalStepId, hrId)
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(store.getLegalAgreementByWorkflow(workflowId), null)
    assert.equal(store.getLegalSignoffRecordByWorkflow(workflowId), null)
    assert.equal(store.getApproval(approvalId), null)

    const redo = store.createApproval({ workflowId, stepId: legalStepId, approverId: legalId, status: 'allocated' })
    approvalId = redo.id
    await rerunStructuredReview(workflowId, 'legal_verification', legalId, stub)
    const agreementTask = latestLog().tasks.find((t) => t.id === 'confidentiality_agreement')!
    assert.equal(agreementTask.status, 'warning')
    assert.ok(agreementTask.evidence.every((e) => e.type !== 'record_created'))
    assert.equal(buildAgreementDraft(compileLegalVerificationSource(workflowId)).ready, true)
  })
})

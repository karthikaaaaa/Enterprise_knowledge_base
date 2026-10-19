import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { AiVerificationLog, NarrativeGenerator } from '@/lib/ai-verification-log'
import * as store from '@/lib/workflow-store'
import { rerunStructuredReview } from '@/lib/workflow-actions'
import { revertStep } from '@/lib/workflow-revert'
import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import { confirmLegalClearance, getLegalClearanceState } from '@/lib/offboarding/legal-clearance'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: OFFBOARDING_TASK_IDS.legal_clearance.map((id) => ({ id, recommendation: 'Stub.' })) }),
  model: 'stub',
})

const OFFBOARDING_STEPS: [string, string][] = [
  ['exit_initiated', 'HR'],
  ['manager_exit_approval', 'Manager'],
  ['hr_exit_approval', 'HR'],
  ['knowledge_transfer', 'Manager'],
  ['it_access_deactivation', 'IT'],
  ['asset_recovery', 'IT'],
  ['finance_settlement', 'Finance'],
  ['legal_clearance', 'Legal'],
  ['exit_completed', 'HR'],
]

describe('offboarding: Legal confirms clearance tasks the records cannot settle', () => {
  let wf: string
  let stepId: string
  let hr: string, legal: string, otherLegal: string

  const task = (id: string) => {
    const run = store.listAiVerificationRunsForWorkflowStep(wf, 'legal_clearance')[0]
    return (run.result as AiVerificationLog).tasks.find((t) => t.id === id)!
  }

  before(async () => {
    const role = (n: string) => store.getOrCreateRole(n).id
    hr = store.createUser({ name: 'Clear HR', email: 'clear-hr@test.local', hashedPassword: 'x', roleId: role('HR') }).id
    legal = store.listUsersByRole(role('Legal'))[0]?.id ?? store.createUser({ name: 'Clear Legal', email: 'clear-legal@test.local', hashedPassword: 'x', roleId: role('Legal') }).id
    otherLegal = store.createUser({ name: 'Other Legal', email: 'clear-legal2@test.local', hashedPassword: 'x', roleId: role('Legal') }).id
    const emp = store.createUser({ name: 'Nina Norecords', email: 'nina@test.local', hashedPassword: 'x', roleId: role('Employee') }).id
    // No signed agreement and no offer letter on file.
    const employee = store.createEmployee({ userId: emp, empCode: 'EMP-NOREC', firstName: 'Nina', lastName: 'Norecords', dateOfJoining: '2024-01-15', dateOfLeaving: '2026-12-31' })

    const template = store.getWorkflowTemplateByType('offboarding') ?? store.createWorkflowTemplate({ name: 'Test Offboarding', type: 'offboarding' })
    const existing = store.listTemplateSteps(template.id)
    OFFBOARDING_STEPS.forEach(([name, dept], i) => {
      if (!existing.some((s) => s.stepName === name)) store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: dept, stepOrder: i + 1 })
    })
    wf = store.createWorkflow({ employeeId: employee.id, type: 'offboarding', status: 'in_progress' }).id
    stepId = store.getWorkflowSteps(wf).find((s) => s.stepName === 'legal_clearance')!.id
    store.createApproval({ workflowId: wf, stepId, approverId: legal, status: 'allocated' })
    assert.ok((await rerunStructuredReview(wf, 'legal_clearance', legal, stub)).ok)
  })

  test('with nothing on file both tasks warn and Legal can confirm them', () => {
    assert.equal(task('confidentiality_obligations').status, 'warning')
    assert.equal(task('restrictive_covenants').status, 'warning')
    const state = getLegalClearanceState(wf)!
    assert.deepEqual(state.needs, { confidentiality_obligations: true, restrictive_covenants: true })
    assert.equal(state.canConfirm, true)
  })

  test('input is validated and only the assigned approver may confirm', async () => {
    const confirm = (userId: string, input: Record<string, unknown>) => confirmLegalClearance(wf, userId, { task: undefined, ...input }, { generate: stub })
    assert.deepEqual(await confirm(otherLegal, { task: 'confidentiality_obligations' }), { ok: false, error: 'not_allowed' })
    assert.equal((await confirm(legal, { task: 'something_else' })).ok, false)
    assert.equal((await confirm(legal, { task: 'restrictive_covenants', clausesApply: 'no' })).ok, false)
    assert.equal((await confirm(legal, { task: 'restrictive_covenants', clausesApply: true, clauses: '  ' })).ok, false)
    assert.equal(task('restrictive_covenants').status, 'warning')
  })

  test('once confirmed both tasks show done, and re-runs keep them', async () => {
    assert.ok((await confirmLegalClearance(wf, legal, { task: 'confidentiality_obligations', note: 'In the exit interview' }, { generate: stub })).ok)
    assert.equal(task('confidentiality_obligations').status, 'done')
    assert.deepEqual(task('confidentiality_obligations').issues, [])
    assert.match(task('confidentiality_obligations').evidence[1].source ?? '', /Confirmed by Legal .* — In the exit interview/)

    assert.ok((await confirmLegalClearance(wf, legal, { task: 'restrictive_covenants', clausesApply: true, clauses: '30-day notice' }, { generate: stub })).ok)
    assert.equal(task('restrictive_covenants').status, 'done')
    assert.equal(task('restrictive_covenants').evidence.at(-1)!.value, 'Apply: 30-day notice')
    // A later confirmation replaces the earlier one.
    assert.ok((await confirmLegalClearance(wf, legal, { task: 'restrictive_covenants', clausesApply: false }, { generate: stub })).ok)
    assert.equal(task('restrictive_covenants').evidence.at(-1)!.value, 'None apply')

    assert.ok((await rerunStructuredReview(wf, 'legal_clearance', legal, stub)).ok)
    assert.equal(task('confidentiality_obligations').status, 'done')
    assert.equal(task('restrictive_covenants').status, 'done')
  })

  test('reverting Legal Clearance clears the confirmations', async () => {
    const r = await revertStep(wf, stepId, hr, 'Redo the clearance')
    assert.ok(r.ok, JSON.stringify(r))
    assert.deepEqual(getLegalClearanceState(wf)!.confirmations, { confidentiality_obligations: null, restrictive_covenants: null })
    store.createApproval({ workflowId: wf, stepId, approverId: legal, status: 'allocated' })
    assert.ok((await rerunStructuredReview(wf, 'legal_clearance', legal, stub)).ok)
    assert.equal(task('confidentiality_obligations').status, 'warning')
    assert.equal(task('restrictive_covenants').status, 'warning')
  })

  test('a review still running when the step is reverted is dropped, not saved', async () => {
    const runsBefore = store.listAiVerificationRunsForWorkflowStep(wf, 'legal_clearance').length
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow: NarrativeGenerator = async (...args) => {
      await gate
      return stub(...args)
    }
    const pending = rerunStructuredReview(wf, 'legal_clearance', legal, slow)
    assert.ok((await revertStep(wf, stepId, hr, 'Reverted mid-review')).ok)
    release()
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(store.listAiVerificationRunsForWorkflowStep(wf, 'legal_clearance').length, runsBefore)
    // The redo starts clean: a fresh approval gets a fresh review.
    store.createApproval({ workflowId: wf, stepId, approverId: legal, status: 'allocated' })
    assert.ok((await rerunStructuredReview(wf, 'legal_clearance', legal, stub)).ok)
    assert.equal(task('confidentiality_obligations').status, 'warning')
  })
})

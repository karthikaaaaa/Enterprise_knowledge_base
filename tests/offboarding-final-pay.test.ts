import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { AiVerificationLog, NarrativeGenerator } from '@/lib/ai-verification-log'
import * as store from '@/lib/workflow-store'
import { rerunStructuredReview } from '@/lib/workflow-actions'
import { revertStep } from '@/lib/workflow-revert'
import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import { confirmReimbursements, enterFinalPay, getFinalPayState } from '@/lib/offboarding/final-pay'
import * as off from '@/lib/offboarding/store'

const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: OFFBOARDING_TASK_IDS.finance_settlement.map((id) => ({ id, recommendation: 'Stub.' })) }),
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

describe('offboarding: Finance enters the final pay when there is no salary on file', () => {
  let wf: string
  let stepId: string
  let hr: string, fin: string, otherFin: string

  const settlementTask = (id: string) => {
    const run = store.listAiVerificationRunsForWorkflowStep(wf, 'finance_settlement')[0]
    return (run.result as AiVerificationLog).tasks.find((t) => t.id === id)!
  }
  const finalPayTask = () => settlementTask('final_pay')
  const reimbursementsTask = () => settlementTask('reimbursements')

  before(async () => {
    const role = (n: string) => store.getOrCreateRole(n).id
    hr = store.createUser({ name: 'Pay HR', email: 'pay-hr@test.local', hashedPassword: 'x', roleId: role('HR') }).id
    fin = store.listUsersByRole(role('Finance'))[0]?.id ?? store.createUser({ name: 'Pay Finance', email: 'pay-fin@test.local', hashedPassword: 'x', roleId: role('Finance') }).id
    otherFin = store.createUser({ name: 'Other Finance', email: 'pay-fin2@test.local', hashedPassword: 'x', roleId: role('Finance') }).id
    const emp = store.createUser({ name: 'Noel Nopay', email: 'noel@test.local', hashedPassword: 'x', roleId: role('Employee') }).id
    // No payroll entry for Noel — the final pay can't be calculated.
    const employee = store.createEmployee({ userId: emp, empCode: 'EMP-NOPAY', firstName: 'Noel', lastName: 'Nopay', dateOfJoining: '2024-01-15', dateOfLeaving: '2026-12-31' })

    const template = store.getWorkflowTemplateByType('offboarding') ?? store.createWorkflowTemplate({ name: 'Test Offboarding', type: 'offboarding' })
    const existing = store.listTemplateSteps(template.id)
    OFFBOARDING_STEPS.forEach(([name, dept], i) => {
      if (!existing.some((s) => s.stepName === name)) store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: dept, stepOrder: i + 1 })
    })
    wf = store.createWorkflow({ employeeId: employee.id, type: 'offboarding', status: 'in_progress' }).id
    stepId = store.getWorkflowSteps(wf).find((s) => s.stepName === 'finance_settlement')!.id
    store.createApproval({ workflowId: wf, stepId, approverId: fin, status: 'allocated' })
    assert.ok((await rerunStructuredReview(wf, 'finance_settlement', fin, stub)).ok)
  })

  test('without a salary the final pay is a placeholder (warning) and Finance can enter it', () => {
    assert.equal(finalPayTask().status, 'warning')
    const state = getFinalPayState(wf)!
    assert.equal(state.finalPay.source, 'placeholder')
    assert.equal(state.canEnter, true)
  })

  test('the entry is validated and only the assigned approver may make it', async () => {
    const enter = (userId: string, amount: unknown, currency: unknown) => enterFinalPay(wf, userId, { amount, currency, note: '' }, { generate: stub })
    assert.deepEqual(await enter(otherFin, 4250, 'USD'), { ok: false, error: 'not_allowed' })
    assert.equal((await enter(fin, -5, 'USD')).ok, false)
    assert.equal((await enter(fin, 'abc', 'USD')).ok, false)
    assert.equal((await enter(fin, 4250, 'dollars')).ok, false)
    assert.equal(finalPayTask().status, 'warning')
  })

  test('once entered, Final pay shows done and the figure is on the settlement statement', async () => {
    const result = await enterFinalPay(wf, fin, { amount: '4250.5', currency: 'usd', note: ' From the offer letter ' }, { generate: stub })
    assert.ok(result.ok, JSON.stringify(result))
    const task = finalPayTask()
    assert.equal(task.status, 'done')
    assert.deepEqual(task.issues, [])
    assert.match(task.evidence[0].value, /USD 4,250\.50/)
    assert.match(task.evidence[0].source ?? '', /Entered by Finance/)
    const statement = off.getSettlementStatement(wf)!.statement as { finalPay: { amount: number; currency: string; source: string } }
    assert.deepEqual([statement.finalPay.amount, statement.finalPay.currency, statement.finalPay.source], [4250.5, 'USD', 'finance'])
    // Re-runs keep the entered figure.
    assert.ok((await rerunStructuredReview(wf, 'finance_settlement', fin, stub)).ok)
    assert.equal(finalPayTask().status, 'done')
    assert.equal(getFinalPayState(wf)!.entry?.amount, 4250.5)
  })

  test('Finance confirms the pending reimbursements, which then show done', async () => {
    assert.equal(reimbursementsTask().status, 'warning')
    assert.equal(getFinalPayState(wf)!.canConfirmReimbursements, true)
    const confirm = (userId: string, input: { outstanding: unknown; amount?: unknown; currency?: unknown }) =>
      confirmReimbursements(wf, userId, { amount: undefined, currency: undefined, note: '', ...input }, { generate: stub })
    assert.deepEqual(await confirm(otherFin, { outstanding: false }), { ok: false, error: 'not_allowed' })
    assert.equal((await confirm(fin, { outstanding: 'no' })).ok, false)
    assert.equal((await confirm(fin, { outstanding: true, amount: 0, currency: 'USD' })).ok, false)
    assert.equal(reimbursementsTask().status, 'warning')

    assert.ok((await confirm(fin, { outstanding: false })).ok)
    assert.equal(reimbursementsTask().status, 'done')
    assert.deepEqual(reimbursementsTask().issues, [])
    assert.equal(reimbursementsTask().evidence[0].value, 'None outstanding')

    // Changing it to an outstanding amount keeps it done and puts the figure on the statement.
    assert.ok((await confirm(fin, { outstanding: true, amount: '180', currency: 'usd' })).ok)
    assert.equal(reimbursementsTask().status, 'done')
    assert.match(reimbursementsTask().evidence[0].value, /USD 180\.00 outstanding/)
    const statement = off.getSettlementStatement(wf)!.statement as { reimbursements: { status: string; amount: number }; manualFinalPay?: unknown }
    assert.deepEqual([statement.reimbursements.status, statement.reimbursements.amount], ['outstanding', 180])
    assert.ok(statement.manualFinalPay, 'the final pay entry is kept')
    // Re-runs keep it.
    assert.ok((await rerunStructuredReview(wf, 'finance_settlement', fin, stub)).ok)
    assert.equal(reimbursementsTask().status, 'done')
    assert.equal(finalPayTask().status, 'done')
  })

  test('reverting Finance Settlement clears the entered final pay and reimbursements', async () => {
    const r = await revertStep(wf, stepId, hr, 'Redo the settlement')
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(off.getSettlementStatement(wf), null)
    store.createApproval({ workflowId: wf, stepId, approverId: fin, status: 'allocated' })
    assert.ok((await rerunStructuredReview(wf, 'finance_settlement', fin, stub)).ok)
    assert.equal(getFinalPayState(wf)!.entry, null)
    assert.equal(getFinalPayState(wf)!.reimbursements, null)
    assert.equal(finalPayTask().status, 'warning')
    assert.equal(reimbursementsTask().status, 'warning')
  })
})

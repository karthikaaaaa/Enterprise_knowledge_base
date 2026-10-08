import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NarrativeGenerator, AiVerificationLog } from '@/lib/ai-verification-log'
import * as store from '@/lib/workflow-store'
import { getCaller } from '@/lib/server-auth'
import { verifyStep } from '@/lib/workflow-actions'
import { revertStep } from '@/lib/workflow-revert'
import {
  recordExitDetails,
  hrEditExitDetails,
  notifyOffboardingStep,
  managerExitDecision,
  generateHrExitPrecheck,
  hrExitApprove,
} from '@/lib/offboarding/actions'
import { requestExitDetails, renotifyExitDetailsRequest, submitExitDetails, requestableFieldsNow, getOpenExitInfoRequest } from '@/lib/offboarding/exit-info-requests'
import { loadOffboarding } from '@/lib/offboarding/context'
import { getOffboardingState } from '@/lib/offboarding/view'
import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import * as off from '@/lib/offboarding/store'

/** Model stub: valid narrative for the HR exit pre-check. */
const stub: NarrativeGenerator = async () => ({
  text: JSON.stringify({ shortSummary: 'Stub.', tasks: OFFBOARDING_TASK_IDS.hr_exit_approval.map((id) => ({ id, recommendation: 'Stub.' })) }),
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const role = (n: string) => store.getOrCreateRole(n).id
const caller = (email: string) => getCaller(new Request('http://test.local', { headers: { 'x-user-email': email } }))!

let hr: string
let manager: string
let otherEmployee: string
let seq = 0

function ensureTemplate() {
  const template = store.getWorkflowTemplateByType('offboarding') ?? store.createWorkflowTemplate({ name: 'Test Offboarding', type: 'offboarding' })
  const existing = store.listTemplateSteps(template.id)
  OFFBOARDING_STEPS.forEach(([name, dept], i) => {
    if (!existing.some((s) => s.stepName === name)) store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: dept, stepOrder: i + 1 })
  })
}

/** An exiting employee whose workflow looks like the seeded Mei: Exit Initiated already verified
 * with nothing recorded, the last working day only on the employee record (in the past). Manager
 * has approved; HR Exit Approval's pre-check has been generated. */
async function setUpAtHrExitApproval(dateOfLeaving = day(-15)) {
  seq += 1
  const email = `exiter${seq}@test.local`
  const user = store.createUser({ name: `Exiter ${seq}`, email, hashedPassword: 'x', roleId: role('Employee') })
  const employee = store.createEmployee({ userId: user.id, empCode: `EMP-EXD-${seq}`, firstName: 'Exiter', lastName: String(seq), dateOfJoining: '2023-01-01', dateOfLeaving })
  const wf = store.createWorkflow({ employeeId: employee.id, type: 'offboarding', status: 'in_progress' }).id
  const steps = new Map(store.getWorkflowSteps(wf).map((s) => [s.stepName, s.id]))
  const now = new Date().toISOString()
  store.createApproval({ workflowId: wf, stepId: steps.get('exit_initiated')!, approverId: hr, status: 'verified', verifiedBy: hr, verifiedAt: now })
  assert.ok((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { managerUserId: manager, generate: stub })).ok)
  assert.ok(managerExitDecision(wf, manager, { decision: 'approved', comment: 'OK' }).ok)
  assert.ok((await verifyStep(wf, steps.get('manager_exit_approval')!, hr)).ok)
  assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok)
  return { wf, steps, emp: user.id, email, employeeId: employee.id }
}

function latestRun(wf: string) {
  const ctx = loadOffboarding(wf)!
  const step = ctx.steps.find((s) => s.stepName === 'hr_exit_approval')!
  const approval = store.listApprovalsByWorkflow(wf).filter((a) => a.stepId === step.id).at(-1)!
  const run = store.listAiVerificationRuns(approval.id, 'hr_exit_approval')[0]
  return { run, log: run.result as AiVerificationLog }
}

const task = (log: AiVerificationLog, id: string) => log.tasks.find((t) => t.id === id)!

describe('offboarding: HR exit approval resolves missing data', () => {
  before(() => {
    ensureTemplate()
    hr = store.createUser({ name: 'Exd HR', email: 'exd-hr@test.local', hashedPassword: 'x', roleId: role('HR') }).id
    manager = store.createUser({ name: 'Exd Manager', email: 'exd-mgr@test.local', hashedPassword: 'x', roleId: role('Manager') }).id
    otherEmployee = store.createUser({ name: 'Bystander', email: 'exd-other@test.local', hashedPassword: 'x', roleId: role('Employee') }).id
  })

  test('missing data → request → employee submits → AI re-run → clean approval with no gating', async () => {
    const { wf, emp, email } = await setUpAtHrExitApproval()

    // First pre-check: the seeded state flags exactly what's missing.
    let { log } = latestRun(wf)
    assert.equal(log.overallStatus, 'needs_attention')
    assert.deepEqual([...log.missingData].sort(), ['Exit type', 'Forwarding contact', 'Notice start date', 'Reason for leaving'])
    assert.ok(task(log, 'notice_period').issues.some((i) => i.includes('in the past and has not been confirmed')))
    assert.deepEqual(task(log, 'notice_period').evidence.find((e) => e.label === 'Notice policy')?.value.startsWith('Notice policy not available'), true)
    assert.equal(task(log, 'anomalies').status, 'done', 'nothing concrete is unusual')
    assert.deepEqual(requestableFieldsNow(loadOffboarding(wf)!).sort(), ['forwardingContact', 'noticeStartDate', 'reason'])

    // HR requests (adding the last working day so the employee proposes a new one).
    const requested = requestExitDetails(wf, hr, { fields: ['reason', 'noticeStartDate', 'forwardingContact', 'lastWorkingDay'] })
    assert.ok(requested.ok)
    assert.equal((requestExitDetails(wf, hr) as { error?: string }).error, 'wrong_state', 'only one open request')
    assert.ok(renotifyExitDetailsRequest(wf, hr).ok)

    // The in-app notification reaches this employee only, listing the fields.
    const employeeRole = role('Employee')
    const mine = store.listNotificationsByRole(employeeRole, emp).filter((n) => n.message.includes('HR needs a few details'))
    assert.equal(mine.length, 1)
    assert.ok(mine[0].message.includes('Reason for leaving') && mine[0].message.includes('Forwarding contact'))
    assert.ok(store.listNotificationsByRole(employeeRole, emp).some((n) => n.message.startsWith('Reminder — HR still needs')))
    assert.equal(store.listNotificationsByRole(employeeRole, otherEmployee).filter((n) => n.message.includes('process your exit')).length, 0)

    // The employee sees the request (only the requested fields).
    const empState = getOffboardingState(wf, caller(email)) as { exitDetailsRequest: { id: string; fields: string[] } | null }
    assert.deepEqual(empState.exitDetailsRequest?.fields, ['reason', 'noticeStartDate', 'forwardingContact', 'lastWorkingDay'])
    const hrState = getOffboardingState(wf, caller('exd-hr@test.local')) as { exitDetailsRequest: { status: string } }
    assert.equal(hrState.exitDetailsRequest.status, 'open')

    const requestId = requested.ok ? requested.request.id : ''
    // Validation: missing field, bad contact, notice start after last working day.
    assert.equal((await submitExitDetails(wf, requestId, emp, { fields: { reason: 'Moving' } }, { generate: stub })).ok, false)
    assert.equal(
      (await submitExitDetails(wf, requestId, emp, { fields: { reason: 'Moving abroad', noticeStartDate: day(-5), forwardingContact: 'nope', lastWorkingDay: day(30) } }, { generate: stub })).ok,
      false,
    )
    assert.equal(
      (await submitExitDetails(wf, requestId, emp, { fields: { reason: 'Moving abroad', noticeStartDate: day(40), forwardingContact: 'me@home.test', lastWorkingDay: day(30) } }, { generate: stub })).ok,
      false,
    )
    // Someone else can't answer it, HR included.
    assert.equal((await submitExitDetails(wf, requestId, hr, { fields: {} }, { generate: stub }) as { error?: string }).error, 'not_allowed')

    const submitted = await submitExitDetails(
      wf,
      requestId,
      emp,
      // exitType in the body is ignored — only the requested fields are read.
      { fields: { reason: 'Moving abroad', noticeStartDate: day(-5), forwardingContact: 'me@home.test', lastWorkingDay: day(30), exitType: 'termination' } },
      { generate: stub },
    )
    assert.deepEqual(submitted, { ok: true, rerun: 'done' })
    assert.equal(getOpenExitInfoRequest(wf), null)
    assert.ok(store.listNotificationsByRole(role('HR')).some((n) => n.message.includes('submitted the requested exit details')))

    const details = off.getExitDetails(wf)!
    assert.equal(details.exitType, 'not_recorded', 'the employee cannot set the exit type')
    assert.equal(details.reason, 'Moving abroad')
    assert.equal(details.sources.reason?.source, 'employee')

    // Re-run: only the HR-only exit type is still missing; evidence shows where values came from.
    ;({ log } = latestRun(wf))
    assert.deepEqual(log.missingData, ['Exit type'])
    assert.ok(task(log, 'exit_details').evidence.find((e) => e.label === 'Reason')!.source.startsWith('Employee-submitted by Exiter'))
    assert.equal(task(log, 'notice_period').status, 'done')
    assert.deepEqual(requestableFieldsNow(loadOffboarding(wf)!), [], 'nothing left to ask the employee')

    // HR sets the exit type → re-run → Ready → plain approve, no checkbox / comment.
    const edited = await hrEditExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(30), reason: undefined }, stub)
    assert.deepEqual(edited, { ok: true, rerun: true })
    ;({ log } = latestRun(wf))
    assert.equal(log.overallStatus, 'ready')
    assert.deepEqual(log.missingData, [])
    assert.ok(log.tasks.every((t) => t.status === 'done' && t.issues.length === 0))
    assert.ok((await hrExitApprove(wf, hr, {})).ok)

    // Audit: every field change with who / old → new; and every run kept.
    const changes = off.listWorkflowEvents(wf).filter((e) => e.action === 'exit_detail_changed')
    const reasonChange = changes.find((c) => c.detail.field === 'reason')!
    assert.deepEqual([reasonChange.detail.old, reasonChange.detail.new, reasonChange.detail.source, reasonChange.performedBy], [null, 'Moving abroad', 'employee', emp])
    const typeChange = changes.find((c) => c.detail.field === 'exitType')!
    assert.deepEqual([typeChange.detail.old, typeChange.detail.new, typeChange.performedBy], ['not_recorded', 'resignation', hr])
    assert.equal(store.listAiVerificationRunsForWorkflowStep(wf, 'hr_exit_approval').length, 3)
  })

  test('partial submission → warnings remain → gated approval still works', async () => {
    const { wf, emp } = await setUpAtHrExitApproval()
    const requested = requestExitDetails(wf, hr, { fields: ['reason'] })
    assert.ok(requested.ok)
    assert.ok((await submitExitDetails(wf, requested.ok ? requested.request.id : '', emp, { fields: { reason: 'Career change' } }, { generate: stub })).ok)

    const { log } = latestRun(wf)
    assert.equal(log.overallStatus, 'needs_attention')
    assert.ok(log.missingData.includes('Forwarding contact') && log.missingData.includes('Notice start date'))
    assert.ok(!log.missingData.includes('Reason for leaving'))
    // The request button stays available for what's still missing.
    assert.deepEqual(requestableFieldsNow(loadOffboarding(wf)!).sort(), ['forwardingContact', 'noticeStartDate'])

    assert.equal((await hrExitApprove(wf, hr, {}) as { error?: string }).error, 'review_required')
    assert.equal((await hrExitApprove(wf, hr, { acknowledged: true, comment: '' }) as { error?: string }).error, 'review_required')
    assert.ok((await hrExitApprove(wf, hr, { acknowledged: true, comment: 'Contact details to follow by email' })).ok)
  })

  test('employees never set the exit type, and never get the form for a termination', async () => {
    const { wf, emp, email } = await setUpAtHrExitApproval()
    const requested = requestExitDetails(wf, hr, { fields: ['reason', 'forwardingContact'] })
    assert.ok(requested.ok)

    // HR then records it as a termination: the open request disappears from the employee's view
    // and can't be answered; HR can't raise a new one either.
    assert.ok((await hrEditExitDetails(wf, hr, { exitType: 'termination', lastWorkingDay: day(10), reason: 'Policy breach' }, stub)).ok)
    const empState = getOffboardingState(wf, caller(email)) as { exitDetailsRequest: unknown }
    assert.equal(empState.exitDetailsRequest, null)
    assert.equal((await submitExitDetails(wf, requested.ok ? requested.request.id : '', emp, { fields: { reason: 'x', forwardingContact: 'a@b.test' } }, { generate: stub }) as { error?: string }).error, 'not_allowed')
    assert.deepEqual(requestableFieldsNow(loadOffboarding(wf)!), [])
    assert.equal(off.getExitDetails(wf)!.exitType, 'termination')
    assert.equal(off.getExitDetails(wf)!.reason, 'Policy breach')
  })

  test('a fresh termination: HR cannot request details from the employee at all', async () => {
    const { wf } = await setUpAtHrExitApproval()
    assert.ok((await hrEditExitDetails(wf, hr, { exitType: 'termination', lastWorkingDay: day(10), reason: 'Redundancy' }, stub)).ok)
    assert.equal((requestExitDetails(wf, hr, { fields: ['forwardingContact'] }) as { error?: string }).error, 'not_allowed')
  })

  test('HR edits fields directly: confirming a past last working day makes it an accepted fact', async () => {
    const { wf } = await setUpAtHrExitApproval(day(-20))
    // Validation.
    assert.equal(recordExitDetails(wf, hr, { exitType: 'termination', lastWorkingDay: day(-20), reason: '' }).ok, false)
    assert.equal(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(-20), reason: 'x', noticeStartDate: day(-10) }).ok, false, 'notice start after LWD')
    assert.equal(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(-20), reason: 'Relocating', forwardingContact: 'not a contact' }).ok, false)

    // All fields, last working day in the past but not confirmed → warning.
    let r = await hrEditExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(-20), reason: 'Relocating', noticeStartDate: day(-50), forwardingContact: '+44 7700 900123' }, stub)
    assert.ok(r.ok)
    let { log } = latestRun(wf)
    assert.equal(task(log, 'notice_period').status, 'warning')
    assert.equal(log.overallStatus, 'needs_attention')

    // HR confirms it → no longer an issue; evidence records the confirmation.
    r = await hrEditExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(-20), reason: 'Relocating', confirmLastWorkingDay: true }, stub)
    assert.ok(r.ok)
    ;({ log } = latestRun(wf))
    assert.equal(task(log, 'notice_period').status, 'done')
    assert.ok(task(log, 'notice_period').evidence.some((e) => e.label === 'HR confirmation' && e.value.includes('accepted although it is in the past')))
    assert.equal(log.overallStatus, 'ready')
    assert.ok(task(log, 'exit_details').evidence.find((e) => e.label === 'Forwarding contact')!.source.startsWith('HR-entered by Exd HR'))

    // Changing the date drops the confirmation again.
    assert.ok(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(-19), reason: 'Relocating' }).ok)
    assert.equal(off.getExitDetails(wf)!.lwdConfirmedAt, null)
    assert.ok(off.listWorkflowEvents(wf).some((e) => e.action === 'last_working_day_confirmed'))
  })

  test('reverting HR Exit Approval keeps the exit details, and earlier runs stay in the history', async () => {
    const { wf, steps } = await setUpAtHrExitApproval()
    assert.ok((await hrEditExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(30), reason: 'Studies', noticeStartDate: day(-1), forwardingContact: 'x@y.test' }, stub)).ok)
    assert.ok((await hrExitApprove(wf, hr, {})).ok)
    const runsBefore = store.listAiVerificationRunsForWorkflowStep(wf, 'hr_exit_approval').length

    assert.ok((await revertStep(wf, steps.get('hr_exit_approval')!, hr, 'Re-check')).ok)
    assert.equal(off.getExitDetails(wf)!.reason, 'Studies', 'submitted details kept')
    assert.equal(store.listApprovalsByWorkflow(wf).some((a) => a.stepId === steps.get('hr_exit_approval')), false, 'AI result invalidated')
    assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok, 'the pre-check re-runs')
    assert.equal(store.listAiVerificationRunsForWorkflowStep(wf, 'hr_exit_approval').length, runsBefore + 1)
  })
})

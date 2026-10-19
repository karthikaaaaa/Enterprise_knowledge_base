import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import * as store from '@/lib/workflow-store'
import { getCaller } from '@/lib/server-auth'
import { resolveKbAccess } from '@/lib/kb-access'
import { verifyStep } from '@/lib/workflow-actions'
import { verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { revertStep } from '@/lib/workflow-revert'
import { listDocuments, documentOwner } from '@/lib/document-store'
import {
  recordExitDetails,
  notifyOffboardingStep,
  managerExitDecision,
  generateHrExitPrecheck,
  hrExitApprove,
  confirmHandover,
  acceptHandover,
  markAsset,
  completeAssetRecovery,
} from '@/lib/offboarding/actions'
import { requestExitDetails, getOpenExitInfoRequest } from '@/lib/offboarding/exit-info-requests'
import { OFFBOARDING_TASK_IDS, type OffboardingReviewKey } from '@/lib/offboarding/reviews'
import { offboardingStatusForUser } from '@/lib/offboarding/access'
import { getOffboardingState } from '@/lib/offboarding/view'
import * as off from '@/lib/offboarding/store'

const stub: NarrativeGenerator = async (system) => {
  for (const key of Object.keys(OFFBOARDING_TASK_IDS) as OffboardingReviewKey[]) {
    if (OFFBOARDING_TASK_IDS[key].every((id) => system.includes(id))) {
      return { text: JSON.stringify({ shortSummary: 'Stub.', tasks: OFFBOARDING_TASK_IDS[key].map((id) => ({ id, recommendation: 'Stub.' })) }), model: 'stub' }
    }
  }
  return { text: 'Stub handover notes.', model: 'stub' }
}

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
const caller = (email: string) => getCaller(new Request('http://test.local', { headers: { 'x-user-email': email } }))

describe('offboarding: reverting Exit Initiated undoes the whole offboarding', () => {
  let wf: string
  let steps: Map<string, string>
  let hr: string, manager: string, managerName: string, otherManager: string, it: string, fin: string, emp: string
  let employeeId: string
  let laptop: string
  let grantId: string
  const lwd = day(40)

  const stepId = (key: string) => steps.get(key)!
  const approval = (key: string) => store.listApprovalsByWorkflow(wf).filter((a) => a.stepId === stepId(key)).at(-1) ?? null
  const role = (n: string) => store.getOrCreateRole(n).id
  const mine = (roleName: string, userId: string | null = null) => store.listNotificationsByRole(role(roleName), userId).map((n) => n.message)

  before(async () => {
    hr = store.createUser({ name: 'Rev HR', email: 'rev-hr@test.local', hashedPassword: 'x', roleId: role('HR') }).id
    const mgr = store.createUser({ name: 'Rev Manager', email: 'rev-mgr@test.local', hashedPassword: 'x', roleId: role('Manager') })
    manager = mgr.id
    managerName = mgr.name
    otherManager = store.createUser({ name: 'Unrelated Manager', email: 'rev-mgr2@test.local', hashedPassword: 'x', roleId: role('Manager') }).id
    // Department tasks go to the first user with the role (departmentHead) — reuse one if another
    // test file already made it, so this file doesn't change who owns their tasks.
    const headOf = (roleName: string, name: string, email: string) =>
      store.listUsersByRole(role(roleName))[0]?.id ?? store.createUser({ name, email, hashedPassword: 'x', roleId: role(roleName) }).id
    it = headOf('IT', 'Rev IT', 'rev-it@test.local')
    fin = headOf('Finance', 'Rev Finance', 'rev-fin@test.local')
    emp = store.createUser({ name: 'Rita Revert', email: 'rita.revert@test.local', hashedPassword: 'x', roleId: role('Employee') }).id
    const employee = store.createEmployee({ userId: emp, empCode: 'EMP-REV', firstName: 'Rita', lastName: 'Revert', dateOfJoining: '2023-05-01', dateOfLeaving: null })
    employeeId = employee.id

    const template = store.getWorkflowTemplateByType('offboarding') ?? store.createWorkflowTemplate({ name: 'Test Offboarding', type: 'offboarding' })
    const existing = store.listTemplateSteps(template.id)
    OFFBOARDING_STEPS.forEach(([name, dept], i) => {
      if (!existing.some((s) => s.stepName === name)) store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: dept, stepOrder: i + 1 })
    })
    wf = store.createWorkflow({ employeeId, type: 'offboarding', status: 'in_progress' }).id
    steps = new Map(store.getWorkflowSteps(wf).map((s) => [s.stepName, s.id]))

    // What onboarding gave her, which offboarding takes away.
    const onboardingWf = store.createWorkflow({ employeeId, type: 'onboarding', status: 'completed' }).id
    grantId = store.createEmployeeKbGrant({ workflowId: onboardingWf, employeeId, categories: ['Policies', 'Finance'], grantedBy: hr }).id
    store.createPayrollRecord({ workflowId: onboardingWf, employeeId, legalName: 'Rita Revert', roleTitle: 'Analyst', department: 'Ops', startDate: '2023-05-01', payFrequency: 'monthly', annualSalary: 60000, currency: 'USD', bankDetailsRef: 'x', taxDetailsRef: 'x', sourceRunId: null, createdBy: fin })
    store.createExpenseAccount({ workflowId: onboardingWf, employeeId, holderName: 'Rita Revert', contactEmail: 'r@x.test', costCenter: 'Ops', approverName: null, reimbursementBankRef: 'x', sourceRunId: null, createdBy: fin })
    laptop = store.createAsset({ name: 'Rita laptop', assetType: 'laptop', serialNumber: 'RV-1', assignedEmployeeId: employeeId, status: 'assigned' }).id

    const docsFile = path.join(process.cwd(), 'storage', 'documents.json')
    fs.mkdirSync(path.dirname(docsFile), { recursive: true })
    const docs = fs.existsSync(docsFile) ? JSON.parse(fs.readFileSync(docsFile, 'utf-8') || '[]') : []
    docs.push({ id: 'doc-rita-1', originalName: 'Rita runbook.pdf', storedFilename: 'r.pdf', filePath: 'r.pdf', mimeType: 'application/pdf', size: 10, department: 'Finance', access: 'Department only', uploadedBy: 'Rita Revert', createdAt: new Date().toISOString(), processingStatus: 'processed', visibleDepartments: ['Finance'] })
    fs.writeFileSync(docsFile, JSON.stringify(docs))

    // Walk the offboarding through Finance Settlement, which is left waiting on Finance.
    assert.ok(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: lwd, reason: 'New job', noticeStartDate: day(-5), forwardingContact: 'rita@home.test' }).ok)
    assert.ok((await verifyStep(wf, stepId('exit_initiated'), hr)).ok)
    assert.ok((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { managerUserId: manager, generate: stub })).ok)
    assert.ok(managerExitDecision(wf, manager, { decision: 'approved', comment: null }).ok)
    assert.ok((await verifyStep(wf, stepId('manager_exit_approval'), hr)).ok)
    assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok)
    assert.ok((await hrExitApprove(wf, hr, { acknowledged: true, comment: 'ok' })).ok)
    assert.ok((await notifyOffboardingStep(wf, 'knowledge_transfer', hr, { generate: stub })).ok)
    assert.ok(confirmHandover(wf, emp, { notes: 'Runbook is current.' }).ok)
    assert.ok((await acceptHandover(wf, manager)).ok)
    assert.ok((await verifyStep(wf, stepId('knowledge_transfer'), hr)).ok)
    assert.ok((await notifyOffboardingStep(wf, 'it_access_deactivation', hr, { generate: stub })).ok)
    assert.ok(verifyDepartmentSummaryStep(approval('it_access_deactivation')!.id, it, { acknowledged: true, comment: 'ok' }).ok)
    assert.ok((await verifyStep(wf, stepId('it_access_deactivation'), hr)).ok)
    assert.ok((await notifyOffboardingStep(wf, 'asset_recovery', hr, { generate: stub })).ok)
    assert.ok(markAsset(wf, it, { itemId: off.listAssetReturnItems(wf)[0].id, status: 'returned', notes: null }).ok)
    assert.ok(completeAssetRecovery(wf, it).ok)
    assert.ok((await verifyStep(wf, stepId('asset_recovery'), hr)).ok)
    assert.ok((await notifyOffboardingStep(wf, 'finance_settlement', hr, { generate: stub })).ok)
  })

  test('before the revert: everything offboarding changed is in effect', async () => {
    assert.equal(offboardingStatusForUser(emp), 'exiting')
    assert.equal(approval('finance_settlement')?.status, 'allocated', 'Finance has a pending task')
    assert.ok((store.getDb().prepare('SELECT revoked_at FROM employee_kb_grants WHERE id = ?').get(grantId) as { revoked_at: string | null }).revoked_at)
    assert.equal(off.listFinanceRecordsForEmployee(employeeId).payroll[0].endedAt, lwd)
    assert.equal(documentOwner((await listDocuments()).find((d) => d.id === 'doc-rita-1')!), managerName)
    assert.equal(store.listAssetsByEmployee(employeeId).find((a) => a.id === laptop)?.status, 'available')
  })

  test('reverting Exit Initiated cascades through every step and restores everything', async () => {
    assert.equal((await revertStep(wf, stepId('exit_initiated'), hr, '')).ok, true, 'a reason is optional')
  })

  test('…every later step is Pending again (no approvals, no tasks left)', () => {
    assert.equal(store.listApprovalsByWorkflow(wf).length, 0)
    assert.equal(store.getWorkflow(wf)?.currentStepId, stepId('exit_initiated'))
    assert.equal(store.getWorkflow(wf)?.status, 'in_progress')
  })

  test('…access, KB permissions, payroll/reimbursement, assets and ownership are restored', async () => {
    assert.equal((store.getDb().prepare('SELECT revoked_at FROM employee_kb_grants WHERE id = ?').get(grantId) as { revoked_at: string | null }).revoked_at, null)
    assert.deepEqual(resolveKbAccess(caller('rita.revert@test.local')), { restricted: true, categories: ['Policies', 'Finance'] })
    assert.ok(off.listAccessActions(wf).every((a) => a.status === 'reverted'))
    const records = off.listFinanceRecordsForEmployee(employeeId)
    assert.equal(records.payroll[0].endedAt, null)
    assert.equal(records.expense[0].endedAt, null)
    assert.equal(off.getSettlementStatement(wf), null)
    assert.equal(store.listAssetsByEmployee(employeeId).find((a) => a.id === laptop)?.status, 'assigned')
    assert.equal(documentOwner((await listDocuments()).find((d) => d.id === 'doc-rita-1')!), 'Rita Revert')
    assert.equal(off.getActiveHandoverPlan(wf), null)
  })

  test('…the employee is Active again and the exit details are cleared (kept in the audit trail)', () => {
    assert.equal(offboardingStatusForUser(emp), null)
    assert.ok(caller('rita.revert@test.local'))
    assert.equal(off.getExitDetails(wf), null)
    const cleared = off.listWorkflowEvents(wf).find((e) => e.action === 'exit_details_cleared')!
    assert.equal((cleared.detail.previous as { reason: string }).reason, 'New job')
    // The HR view shows nothing recorded (backfilled from the employee record, which has no date).
    const state = getOffboardingState(wf, caller('rev-hr@test.local')!) as { exitDetails: { exitType: string; lastWorkingDay: string | null } }
    assert.equal(state.exitDetails.exitType, 'not_recorded')
  })

  test('…the employee, their manager (only) and the department with a pending task are notified; audit-logged', () => {
    assert.ok(mine('Employee', emp).some((m) => m.startsWith('Your offboarding has been reverted') && m.includes('active again')))
    assert.ok(mine('Manager', manager).some((m) => m.includes('reverted to before the exit was initiated')))
    assert.equal(mine('Manager', otherManager).filter((m) => m.includes('Rita Revert') && m.includes('reverted to before')).length, 0)
    assert.ok(mine('Finance').some((m) => m.includes('Your pending offboarding task for Rita Revert has been removed')))
    const audit = store.getDb().prepare("SELECT cascaded_step_keys FROM workflow_audit_log WHERE workflow_id = ? AND step_key = 'exit_initiated'").get(wf) as { cascaded_step_keys: string }
    assert.deepEqual(JSON.parse(audit.cascaded_step_keys), ['exit_initiated', 'manager_exit_approval', 'hr_exit_approval', 'knowledge_transfer', 'it_access_deactivation', 'asset_recovery', 'finance_settlement'])
  })

  test('HR can start the offboarding again afterwards, with no leftovers from the first round', async () => {
    assert.ok(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(60), reason: 'Changed plans', noticeStartDate: day(0), forwardingContact: 'rita@home.test' }).ok)
    assert.equal(approval('exit_initiated')?.status, 'completed')
    assert.equal(offboardingStatusForUser(emp), 'exiting')
    assert.ok((await verifyStep(wf, stepId('exit_initiated'), hr)).ok)
    assert.ok((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { generate: stub })).ok, 'manager still on record — no conflict')
    assert.ok(managerExitDecision(wf, manager, { decision: 'approved', comment: null }).ok)
    assert.ok((await verifyStep(wf, stepId('manager_exit_approval'), hr)).ok)
    assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok)
    // The old round's manager decision was reverted; only the new one counts.
    assert.equal(off.getLatestDecision(wf, 'hr_exit_approval'), null)
    assert.ok((await notifyOffboardingStep(wf, 'knowledge_transfer', hr, { generate: stub })).ok === false, 'HR Exit Approval must be approved first')
    assert.ok((await hrExitApprove(wf, hr, { acknowledged: true, comment: 'ok' })).ok)
    assert.ok((await notifyOffboardingStep(wf, 'knowledge_transfer', hr, { generate: stub })).ok)
    assert.equal(off.getActiveHandoverPlan(wf)!.items.length, 1, 'a fresh handover plan, not the archived one')
  })

  test('an open "HR needs a few details" request is withdrawn when Exit Initiated is reverted', async () => {
    // Back to HR Exit Approval with a request open, then revert Exit Initiated again.
    assert.ok((await revertStep(wf, stepId('hr_exit_approval'), hr, 'Redo')).ok)
    assert.ok(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: day(60), reason: 'Changed plans', forwardingContact: '' }).ok)
    assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok)
    assert.ok(requestExitDetails(wf, hr, { fields: ['forwardingContact'] }).ok)
    assert.ok(getOpenExitInfoRequest(wf))
    assert.ok((await revertStep(wf, stepId('exit_initiated'), hr, 'Start over')).ok)
    assert.equal(getOpenExitInfoRequest(wf), null)
    const empState = getOffboardingState(wf, caller('rita.revert@test.local')!) as { exitDetailsRequest: unknown }
    assert.equal(empState.exitDetailsRequest, null)
    assert.equal(offboardingStatusForUser(emp), null)
  })
})

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import * as store from '@/lib/workflow-store'
import { getCaller } from '@/lib/server-auth'
import { resolveKbAccess } from '@/lib/kb-access'
import { verifyStep, rerunStructuredReview } from '@/lib/workflow-actions'
import { verifyDepartmentSummaryStep } from '@/lib/task-actions'
import { revertStep } from '@/lib/workflow-revert'
import { listDocuments, documentOwner } from '@/lib/document-store'
import {
  recordExitDetails,
  notifyOffboardingStep,
  renotifyOffboardingStep,
  managerExitDecision,
  generateHrExitPrecheck,
  hrExitApprove,
  confirmHandover,
  acceptHandover,
  markAsset,
  completeAssetRecovery,
  markExitComplete,
  completionBlockers,
} from '@/lib/offboarding/actions'
import { OFFBOARDING_TASK_IDS, type OffboardingReviewKey } from '@/lib/offboarding/reviews'
import { offboardingStatusForUser } from '@/lib/offboarding/access'
import * as off from '@/lib/offboarding/store'
import { enterFinalPay } from '@/lib/offboarding/final-pay'

/** A model stub that returns valid JSON for whichever review is asking (and plain text for the handover). */
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

const caller = (email: string) => getCaller(new Request('http://test.local', { headers: { 'x-user-email': email } }))

describe('offboarding end to end', () => {
  let wf: string
  let onboardingWf: string
  let steps: Map<string, string>
  let hr: string, manager: string, managerName: string, it: string, fin: string, legal: string, emp: string
  let employeeId: string
  let laptop: string, charger: string
  let grantId: string

  const stepId = (key: string) => steps.get(key)!
  const approval = (key: string) => {
    let latest: store.Approval | null = null
    for (const a of store.listApprovalsByWorkflow(wf)) if (a.stepId === stepId(key)) latest = a
    return latest
  }
  const deptVerify = async (key: string, userId: string) => {
    const a = approval(key)!
    const r = verifyDepartmentSummaryStep(a.id, userId, { acknowledged: true, comment: 'Reviewed in test' })
    assert.ok(r.ok, `${key}: ${JSON.stringify(r)}`)
    assert.ok((await verifyStep(wf, stepId(key), hr)).ok)
  }

  before(() => {
    const role = (n: string) => store.getOrCreateRole(n).id
    hr = store.createUser({ name: 'Off HR', email: 'off-hr@test.local', hashedPassword: 'x', roleId: role('HR') }).id
    const mgrUser = store.createUser({ name: 'Off Manager', email: 'off-mgr@test.local', hashedPassword: 'x', roleId: role('Manager') })
    manager = mgrUser.id
    managerName = mgrUser.name
    // Department tasks go to the first user with the role (departmentHead) — reuse one if another
    // test file already made it, so the result doesn't depend on which file runs first.
    const headOf = (roleName: string, name: string, email: string) =>
      store.listUsersByRole(role(roleName))[0]?.id ?? store.createUser({ name, email, hashedPassword: 'x', roleId: role(roleName) }).id
    it = headOf('IT', 'Off IT', 'off-it@test.local')
    fin = headOf('Finance', 'Off Finance', 'off-fin@test.local')
    legal = headOf('Legal', 'Off Legal', 'off-legal@test.local')
    const empUser = store.createUser({ name: 'Grace Exiting', email: 'grace.exit@test.local', hashedPassword: 'x', roleId: role('Employee') })
    emp = empUser.id
    const employee = store.createEmployee({ userId: emp, empCode: 'EMP-OFF', firstName: 'Grace', lastName: 'Exiting', dateOfJoining: '2024-01-15', dateOfLeaving: '2026-12-31' })
    employeeId = employee.id

    const template = store.getWorkflowTemplateByType('offboarding') ?? store.createWorkflowTemplate({ name: 'Test Offboarding', type: 'offboarding' })
    const existing = store.listTemplateSteps(template.id)
    OFFBOARDING_STEPS.forEach(([name, dept], i) => {
      if (!existing.some((s) => s.stepName === name)) store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: dept, stepOrder: i + 1 })
    })
    wf = store.createWorkflow({ employeeId, type: 'offboarding', status: 'in_progress' }).id
    steps = new Map(store.getWorkflowSteps(wf).map((s) => [s.stepName, s.id]))

    // What onboarding created for her, which offboarding must reverse.
    onboardingWf = store.createWorkflow({ employeeId, type: 'onboarding', status: 'completed' }).id
    grantId = store.createEmployeeKbGrant({ workflowId: onboardingWf, employeeId, categories: ['Policies', 'IT'], grantedBy: hr }).id
    store.createEmployeeFinanceDetails({ workflowId: onboardingWf, employeeId, requestId: null, accountHolder: 'Grace Exiting', bankAccountNumber: '11112222', bankRoutingCode: '0001', taxId: 'T-1234', fileName: null, fileMimeType: null, fileData: null, submittedBy: emp })
    store.createPayrollRecord({ workflowId: onboardingWf, employeeId, legalName: 'Grace Exiting', roleTitle: 'Analyst', department: 'Ops', startDate: '2024-01-15', payFrequency: 'monthly', annualSalary: 73000, currency: 'USD', bankDetailsRef: 'x', taxDetailsRef: 'x', sourceRunId: null, createdBy: fin })
    store.createExpenseAccount({ workflowId: onboardingWf, employeeId, holderName: 'Grace Exiting', contactEmail: 'g@x.test', costCenter: 'Ops', approverName: null, reimbursementBankRef: 'x', sourceRunId: null, createdBy: fin })

    laptop = store.createAsset({ name: 'Laptop', assetType: 'laptop', serialNumber: 'LT-1', assignedEmployeeId: employeeId, status: 'assigned' }).id
    charger = store.createAsset({ name: 'Charger', assetType: 'peripheral', serialNumber: 'CH-1', assignedEmployeeId: employeeId, status: 'assigned' }).id

    // Two Knowledge Base documents she owns (documents.json lives in the sandbox cwd).
    const storeDir = path.join(process.cwd(), 'storage')
    fs.mkdirSync(storeDir, { recursive: true })
    const docsFile = path.join(storeDir, 'documents.json')
    const docs = fs.existsSync(docsFile) ? JSON.parse(fs.readFileSync(docsFile, 'utf-8') || '[]') : []
    for (const [id, name] of [['doc-grace-1', 'Sales playbook.pdf'], ['doc-grace-2', 'Pricing notes.docx']]) {
      docs.push({ id, originalName: name, storedFilename: name, filePath: name, mimeType: 'application/pdf', size: 10, department: 'Finance', access: 'Department only', uploadedBy: 'Grace Exiting', createdAt: new Date().toISOString(), processingStatus: 'processed', visibleDepartments: ['Finance'] })
    }
    fs.writeFileSync(docsFile, JSON.stringify(docs))
  })

  test('step 1: exit details are validated, recorded, and complete the step for HR to verify', async () => {
    assert.equal(recordExitDetails(wf, hr, { exitType: 'termination', lastWorkingDay: '2026-12-31', reason: '' }).ok, false)
    assert.equal(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: 'soon', reason: '' }).ok, false)
    assert.ok(recordExitDetails(wf, hr, { exitType: 'resignation', lastWorkingDay: '2026-12-31', reason: 'New role' }).ok)
    assert.equal(approval('exit_initiated')?.status, 'completed')
    assert.ok((await verifyStep(wf, stepId('exit_initiated'), hr)).ok)
    assert.equal(offboardingStatusForUser(emp), 'exiting')
  })

  test('step 2: notify needs a manager; HR picks one; re-notify; send back needs a comment; approve', async () => {
    assert.equal(((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { generate: stub })) as { error?: string }).error, 'manager_required')
    assert.ok((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { managerUserId: manager, generate: stub })).ok)
    assert.ok(store.getEmployeeById(employeeId)?.managerId, 'manager saved on the employee record')
    assert.equal(approval('manager_exit_approval')?.approverId, manager)
    assert.equal(((await notifyOffboardingStep(wf, 'manager_exit_approval', hr, { generate: stub })) as { error?: string }).error, 'already_notified')
    assert.ok(renotifyOffboardingStep(wf, 'manager_exit_approval', hr).ok)

    assert.equal((managerExitDecision(wf, it, { decision: 'approved', comment: '' }) as { error?: string }).error, 'not_allowed')
    assert.equal(managerExitDecision(wf, manager, { decision: 'sent_back', comment: ' ' }).ok, false)
    assert.ok(managerExitDecision(wf, manager, { decision: 'sent_back', comment: 'Check the date' }).ok)
    assert.equal(approval('manager_exit_approval')?.status, 'allocated')
    assert.ok(managerExitDecision(wf, manager, { decision: 'approved', comment: 'OK' }).ok)
    assert.equal(approval('manager_exit_approval')?.status, 'completed')
    assert.ok((await verifyStep(wf, stepId('manager_exit_approval'), hr)).ok)
  })

  test('step 3: HR pre-check is generated and approval verifies the step', async () => {
    assert.equal(completionBlockers(wf).length, 6) // steps 3–8 still open
    assert.ok((await generateHrExitPrecheck(wf, hr, stub)).ok)
    const run = store.listAiVerificationRuns(approval('hr_exit_approval')!.id, 'hr_exit_approval')[0]
    const log = run.result as { tasks: { id: string; status: string }[] }
    assert.equal(log.tasks.find((t) => t.id === 'manager_decision')!.status, 'done')
    if (run.overallStatus !== 'ready') {
      assert.equal((await hrExitApprove(wf, hr, {}) as { error?: string }).error, 'review_required')
    }
    assert.ok((await hrExitApprove(wf, hr, { acknowledged: true, comment: 'Fine' })).ok)
    assert.equal(approval('hr_exit_approval')?.status, 'verified')
  })

  test('step 4: handover drafted from owned docs, confirmed by the employee, accepted by the manager — ownership moves', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'knowledge_transfer', hr, { generate: stub })).ok)
    const plan = off.getActiveHandoverPlan(wf)!
    assert.deepEqual(plan.items.map((i) => [i.itemRef, i.newOwner]).sort(), [['doc-grace-1', managerName], ['doc-grace-2', managerName]])
    assert.equal((await acceptHandover(wf, manager) as { error?: string }).error, 'wrong_state', 'employee must confirm first')
    assert.equal((confirmHandover(wf, hr, { notes: 'x' }) as { error?: string }).error, 'not_allowed')
    assert.ok(confirmHandover(wf, emp, { notes: 'Playbook is current; pricing notes need a refresh.' }).ok)
    assert.ok((await acceptHandover(wf, manager)).ok)
    const docs = await listDocuments()
    assert.equal(documentOwner(docs.find((d) => d.id === 'doc-grace-1')!), managerName)
    assert.equal(off.listOwnershipTransfers(wf).length, 2)
    assert.ok((await verifyStep(wf, stepId('knowledge_transfer'), hr)).ok)
  })

  test('step 5: IT access is revoked/scheduled with evidence, KB narrows to handover, and re-runs are idempotent', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'it_access_deactivation', hr, { generate: stub })).ok)
    const grant = store.getDb().prepare('SELECT revoked_at FROM employee_kb_grants WHERE id = ?').get(grantId) as { revoked_at: string | null }
    assert.ok(grant.revoked_at)
    assert.deepEqual(resolveKbAccess(caller('grace.exit@test.local')), { restricted: true, categories: ['Policies'] })
    const ticketsBefore = (store.getDb().prepare('SELECT COUNT(*) n FROM directory_tickets').get() as { n: number }).n
    const actionsBefore = off.listAccessActions(wf).length
    assert.ok((await rerunStructuredReview(wf, 'it_access_deactivation', it, stub)).ok)
    assert.equal((store.getDb().prepare('SELECT COUNT(*) n FROM directory_tickets').get() as { n: number }).n, ticketsBefore, 'no second ticket')
    assert.equal(off.listAccessActions(wf).length, actionsBefore, 'no duplicate actions')
    assert.ok(caller('grace.exit@test.local'), 'login still works until exit completion')
    const log = store.listAiVerificationRuns(approval('it_access_deactivation')!.id, 'it_access_deactivation')[0].result as { tasks: { evidence: { type: string; source: string }[] }[] }
    assert.ok(log.tasks.some((t) => t.evidence.some((e) => e.type === 'record_created' && e.source.startsWith('directory_tickets/'))))
    await deptVerify('it_access_deactivation', it)
  })

  test('step 6: asset checklist from assigned assets; every item must be marked; missing items flagged', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'asset_recovery', hr, { generate: stub })).ok)
    const items = off.listAssetReturnItems(wf)
    assert.equal(items.length, 2)
    assert.equal(completeAssetRecovery(wf, it).ok, false)
    assert.ok(markAsset(wf, it, { itemId: items.find((i) => i.assetId === laptop)!.id, status: 'returned', notes: 'Good condition' }).ok)
    assert.ok(markAsset(wf, it, { itemId: items.find((i) => i.assetId === charger)!.id, status: 'missing', notes: null }).ok)
    assert.ok(completeAssetRecovery(wf, it).ok)
    assert.equal(store.listAssetsByEmployee(employeeId).find((a) => a.id === laptop)?.status, 'available')
    assert.ok((await verifyStep(wf, stepId('asset_recovery'), hr)).ok)
  })

  test('step 7: settlement end-dates payroll + expense, deducts the missing asset, one statement however often it runs', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'finance_settlement', hr, { generate: stub })).ok)
    const records = off.listFinanceRecordsForEmployee(employeeId)
    assert.equal(records.payroll[0].endedAt, '2026-12-31')
    assert.equal(records.expense[0].endedAt, '2026-12-31')
    const statement = off.getSettlementStatement(wf)!.statement as { finalPay: { amount: number; placeholder: boolean }; deductions: unknown[] }
    assert.equal(statement.finalPay.placeholder, false)
    assert.equal(statement.finalPay.amount, 6083.33) // 73000 / 12 × 31/31
    assert.equal(statement.deductions.length, 1)
    assert.ok((await rerunStructuredReview(wf, 'finance_settlement', fin, stub)).ok)
    assert.equal((store.getDb().prepare('SELECT COUNT(*) n FROM settlement_statements WHERE workflow_id = ?').get(wf) as { n: number }).n, 1)
    // Calculated from payroll — Finance can't override it with a hand-entered figure.
    assert.deepEqual(await enterFinalPay(wf, fin, { amount: 1, currency: 'USD', note: '' }, { generate: stub }), { ok: false, error: 'already_calculated' })
    // Flagged (reimbursements can't be confirmed) → Verify needs the acknowledgement.
    assert.deepEqual(verifyDepartmentSummaryStep(approval('finance_settlement')!.id, fin), { ok: false, error: 'review_required' })
    await deptVerify('finance_settlement', fin)
  })

  test('step 8: legal clearance runs and is verified', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'legal_clearance', hr, { generate: stub })).ok)
    await deptVerify('legal_clearance', legal)
  })

  test('step 9: exit completion deactivates the login; no access afterwards', () => {
    assert.deepEqual(completionBlockers(wf), [])
    assert.ok(markExitComplete(wf, hr).ok)
    assert.equal(store.getUserById(emp)?.isActive, false)
    assert.equal(caller('grace.exit@test.local'), null)
    assert.equal(store.getWorkflow(wf)?.status, 'completed')
    assert.equal(offboardingStatusForUser(emp), 'exited')
    assert.equal(markExitComplete(wf, hr).ok, false, 'not twice')
  })

  test('reverting Exit Completed reactivates the login, with the reason audit-logged', async () => {
    const r = await revertStep(wf, stepId('exit_completed'), hr, 'Completed by mistake')
    assert.ok(r.ok)
    assert.equal(store.getUserById(emp)?.isActive, true)
    assert.ok(caller('grace.exit@test.local'))
    const audit = store.getDb().prepare('SELECT reason FROM workflow_audit_log WHERE workflow_id = ? ORDER BY performed_at DESC LIMIT 1').get(wf) as { reason: string }
    assert.equal(audit.reason, 'Completed by mistake')
  })

  test('reverting IT access cascades through assets, settlement and legal, restoring everything', async () => {
    const r = await revertStep(wf, stepId('it_access_deactivation'), hr, 'Redo')
    assert.ok(r.ok)
    assert.deepEqual(r.ok && r.cascadedStepNames.length, 3)
    const grant = store.getDb().prepare('SELECT revoked_at FROM employee_kb_grants WHERE id = ?').get(grantId) as { revoked_at: string | null }
    assert.equal(grant.revoked_at, null)
    // Back to her onboarding grant's categories — no offboarding restriction any more.
    assert.deepEqual(resolveKbAccess(caller('grace.exit@test.local')), { restricted: true, categories: ['Policies', 'IT'] })
    const records = off.listFinanceRecordsForEmployee(employeeId)
    assert.equal(records.payroll[0].endedAt, null)
    assert.equal(records.expense[0].endedAt, null)
    assert.equal(off.getSettlementStatement(wf), null)
    assert.equal(store.listAssetsByEmployee(employeeId).find((a) => a.id === laptop)?.status, 'assigned')
    assert.equal(off.listAssetReturnItems(wf).length, 0)
    const tickets = store.getDb().prepare('SELECT status FROM directory_tickets').all() as { status: string }[]
    assert.ok(tickets.every((t) => t.status === 'cancelled'))
    // Nothing was hard-deleted: the original rows are still there.
    assert.equal(off.listAccessActions(wf).filter((a) => a.status === 'reverted').length > 0, true)
  })

  test('re-notifying after a revert does not duplicate anything', async () => {
    assert.ok((await notifyOffboardingStep(wf, 'it_access_deactivation', hr, { generate: stub })).ok)
    const live = off.listAccessActions(wf, true).filter((a) => a.system === 'sso')
    assert.equal(live.length, 1)
  })

  test('reverting knowledge transfer gives document ownership back', async () => {
    const r = await revertStep(wf, stepId('knowledge_transfer'), hr, 'Wrong owner')
    assert.ok(r.ok)
    const docs = await listDocuments()
    assert.equal(documentOwner(docs.find((d) => d.id === 'doc-grace-1')!), 'Grace Exiting')
    assert.ok(off.listOwnershipTransfers(wf).every((t) => t.revertedAt))
    assert.equal(off.getActiveHandoverPlan(wf), null)
  })
})

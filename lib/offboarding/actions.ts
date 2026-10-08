import {
  createApproval,
  createNotification,
  createStepAiSummary,
  createAiVerificationRun,
  getApproval,
  getEmployeeByUserId,
  getRoleByName,
  listAiVerificationRuns,
  listAssetsByEmployee,
  runInTransaction,
  setUserActive,
  updateApprovalStatus,
  updateWorkflowCurrentStep,
  type Approval,
} from '@/lib/workflow-store'
import { listWorkflowStepDetails } from '@/lib/workflow-view'
import { verifyStep } from '@/lib/workflow-actions'
import { revertStep } from '@/lib/workflow-revert'
import { checkVerifyGate, type AiLogOverallStatus, type NarrativeGenerator } from '@/lib/ai-verification-log'
import { listDocuments, documentOwner, setDocumentOwner } from '@/lib/document-store'
import { humanizeStepName } from '@/lib/workflow-format'
import {
  loadOffboarding,
  approvalOf,
  stepOf,
  exitDetailsFor,
  resolveManagerUser,
  assignManager,
  departmentHead,
  OFFBOARDING_STEPS,
  type OffboardingContext,
  type OffboardingStepKey,
} from '@/lib/offboarding/context'
import {
  applyExitDetailChanges,
  recordDecision,
  getActiveHandoverPlan,
  createHandoverPlan,
  confirmHandoverByEmployee,
  acceptHandoverByManager,
  recordOwnershipTransfer,
  listAccessActions,
  upsertAccessAction,
  ensureAssetReturnItem,
  listAssetReturnItems,
  markAssetReturnItem,
  setAssetStatus,
  recordWorkflowEvent,
  type ExitType,
} from '@/lib/offboarding/store'
import { runOffboardingReview, isOffboardingReviewKey, OFFBOARDING_REVIEW_OWNER } from '@/lib/offboarding/reviews'
import { draftHandover } from '@/lib/offboarding/knowledge-transfer'
import { directoryService } from '@/lib/offboarding/directory-service'
import { isIsoDate, validateExitDetailValues, type ExitDetailFieldKey } from '@/lib/offboarding/exit-detail-fields'

/**
 * Every offboarding step action. Same lifecycle as onboarding: Notify creates an 'allocated'
 * approval for the owner; the owner's action makes it 'completed'; HR's Verify makes it 'verified'
 * (the shared /verify route). Nothing here ever verifies a step on its own except the explicit
 * HR actions (HR Exit Approval's Approve, Mark exit complete), which are themselves the human sign-off.
 */

export type OffboardingError =
  | 'workflow_not_found'
  | 'step_not_found'
  | 'step_locked'
  | 'already_notified'
  | 'not_notifiable'
  | 'manager_required'
  | 'not_allowed'
  | 'invalid_input'
  | 'wrong_state'
  | 'review_required'
  | 'blocked'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: OffboardingError; message?: string }

function fail(error: OffboardingError, message?: string): { ok: false; error: OffboardingError; message?: string } {
  return { ok: false, error, message }
}

function notifyRole(roleName: string, approvalId: string | null, message: string) {
  const role = getRoleByName(roleName)
  if (role) createNotification({ roleId: role.id, approvalId, message })
}

function stepState(workflowId: string, key: OffboardingStepKey) {
  return listWorkflowStepDetails(workflowId).find((s) => s.stepName === key) ?? null
}

/** Throws away anything that isn't "this employee themself". */
function isWorkflowEmployee(ctx: OffboardingContext, userId: string) {
  return getEmployeeByUserId(userId)?.id === ctx.employee.id
}

// ---------- Step 1: exit details ----------

const EXIT_TYPES: ExitType[] = ['resignation', 'termination']

export type ExitDetailsInput = {
  exitType: unknown
  lastWorkingDay: unknown
  reason: unknown
  noticeStartDate?: unknown
  forwardingContact?: unknown
  /** HR explicitly accepts the last working day (even one in the past) — see the pre-check. */
  confirmLastWorkingDay?: unknown
}

/** A string field from the form: undefined = not sent (leave as is), '' = clear it. */
function formField(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

/** HR records or edits the exit details. HR can set every field (and is the only one who sets the
 * exit type). Each changed field is audit-logged (who, when, old → new) by applyExitDetailChanges. */
export function recordExitDetails(workflowId: string, hrUserId: string, input: ExitDetailsInput): Result<{ changed: number }> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  if (approvalOf(ctx, 'hr_exit_approval')?.status === 'verified') return fail('wrong_state', 'Exit details are locked once HR has approved the exit')
  if (!EXIT_TYPES.includes(input.exitType as ExitType)) return fail('invalid_input', 'Choose resignation or termination')
  const lwd = formField(input.lastWorkingDay) ?? ''
  if (!isIsoDate(lwd)) return fail('invalid_input', 'Enter the last working day as a date')
  const reason = formField(input.reason)
  const noticeStartDate = formField(input.noticeStartDate)
  const forwardingContact = formField(input.forwardingContact)

  const current = exitDetailsFor(ctx)
  const mergedReason = reason !== undefined ? reason || null : current.reason
  if (input.exitType === 'termination' && !mergedReason) return fail('invalid_input', 'A reason is required for a termination')
  const toValidate: Partial<Record<ExitDetailFieldKey, string>> = { lastWorkingDay: lwd }
  if (reason) toValidate.reason = reason.slice(0, 1000)
  if (noticeStartDate) toValidate.noticeStartDate = noticeStartDate
  if (forwardingContact) toValidate.forwardingContact = forwardingContact
  const problem = validateExitDetailValues(toValidate, {
    lastWorkingDay: lwd,
    noticeStartDate: noticeStartDate !== undefined ? noticeStartDate || null : current.noticeStartDate,
  })
  if (problem) return fail('invalid_input', problem)

  let changed = 0
  runInTransaction(() => {
    changed = applyExitDetailChanges(
      workflowId,
      {
        exitType: input.exitType as ExitType,
        lastWorkingDay: lwd,
        ...(reason !== undefined ? { reason: reason ? reason.slice(0, 1000) : null } : {}),
        ...(noticeStartDate !== undefined ? { noticeStartDate: noticeStartDate || null } : {}),
        ...(forwardingContact !== undefined ? { forwardingContact: forwardingContact || null } : {}),
      },
      { source: 'hr', userId: hrUserId },
      { confirmLastWorkingDay: input.confirmLastWorkingDay === true },
    ).length
    // A brand-new (or reverted) workflow's step 1 completes when HR records the details; HR then verifies it.
    const step = stepOf(ctx, 'exit_initiated')
    if (step && !approvalOf(ctx, 'exit_initiated')) {
      createApproval({ workflowId, stepId: step.id, approverId: hrUserId, status: 'completed', completedBy: hrUserId, completedAt: new Date().toISOString() })
      recordWorkflowEvent({ workflowId, stepKey: 'exit_initiated', action: 'exit_details_recorded', detail: { exitType: input.exitType, lastWorkingDay: lwd }, performedBy: hrUserId })
    }
  })
  return { ok: true, changed }
}

/** The route's "Edit exit details": saves, then — if HR Exit Approval is open with a pre-check —
 * re-runs the pre-check so the result reflects HR's edit straight away. */
export async function hrEditExitDetails(workflowId: string, hrUserId: string, input: ExitDetailsInput, generate?: NarrativeGenerator): Promise<Result<{ rerun: boolean }>> {
  const saved = recordExitDetails(workflowId, hrUserId, input)
  if (!saved.ok) return saved
  const ctx = loadOffboarding(workflowId)!
  const approval = approvalOf(ctx, 'hr_exit_approval')
  if (approval?.status !== 'allocated' || listAiVerificationRuns(approval.id, 'hr_exit_approval').length === 0) return { ok: true, rerun: false }
  const rerun = await generateHrExitPrecheck(workflowId, hrUserId, generate)
  return { ok: true, rerun: rerun.ok }
}

// ---------- Notify / re-notify ----------

const NOTIFIABLE: OffboardingStepKey[] = ['manager_exit_approval', 'knowledge_transfer', 'it_access_deactivation', 'asset_recovery', 'finance_settlement', 'legal_clearance']

export async function notifyOffboardingStep(
  workflowId: string,
  stepKey: string,
  hrUserId: string,
  options: { managerUserId?: unknown; generate?: NarrativeGenerator } = {},
): Promise<Result> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  if (!NOTIFIABLE.includes(stepKey as OffboardingStepKey)) return fail('not_notifiable')
  const key = stepKey as OffboardingStepKey
  const step = stepOf(ctx, key)
  const state = stepState(workflowId, key)
  if (!step || !state) return fail('step_not_found')
  if (state.locked) return fail('step_locked')
  if (state.approval) return fail('already_notified')

  let approverId: string | null
  let ownerRole: string
  if (key === 'manager_exit_approval' || key === 'knowledge_transfer') {
    let manager = resolveManagerUser(ctx)
    if (!manager && typeof options.managerUserId === 'string') manager = assignManager(ctx, options.managerUserId)
    if (!manager) return fail('manager_required', 'No reporting manager is set — choose one')
    approverId = manager.id
    ownerRole = 'Manager'
  } else {
    ownerRole = step.departmentName
    approverId = departmentHead(ownerRole)?.id ?? null
  }

  // Slow / AI work happens before the approval exists, so a failure leaves the step un-notified
  // (HR sees the error and can retry) rather than half-created.
  let handover: Awaited<ReturnType<typeof draftHandover>> | null = null
  if (key === 'knowledge_transfer') handover = await draftHandover(ctx, options.generate)
  const review = isOffboardingReviewKey(key) ? await runOffboardingReview(key, workflowId, hrUserId, options.generate) : null

  runInTransaction(() => {
    const approval = createApproval({ workflowId, stepId: step.id, approverId, status: 'allocated' })
    if (review && isOffboardingReviewKey(key)) {
      createStepAiSummary({ workflowId, stepId: step.id, approvalId: approval.id, stepKey: key, summaryText: review.shortSummary, generatedAt: review.generatedAt })
      createAiVerificationRun({ id: review.runId, workflowId, stepKey: key, approvalId: approval.id, result: review, generatedBy: hrUserId })
    }
    if (handover) createHandoverPlan({ workflowId, ...handover })
    if (key === 'asset_recovery') {
      for (const asset of listAssetsByEmployee(ctx.employee.id)) ensureAssetReturnItem(workflowId, asset)
    }
    notifyRole(ownerRole, approval.id, `Offboarding: ${humanizeStepName(key)} needed for ${ctx.name}`)
    recordWorkflowEvent({ workflowId, stepKey: key, action: 'notified', detail: { ownerRole, approverId }, performedBy: hrUserId })
  })
  return { ok: true }
}

export function renotifyOffboardingStep(workflowId: string, stepKey: string, hrUserId: string): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  if (!NOTIFIABLE.includes(stepKey as OffboardingStepKey)) return fail('not_notifiable')
  const key = stepKey as OffboardingStepKey
  const approval = approvalOf(ctx, key)
  if (!approval || approval.status !== 'allocated') return fail('wrong_state', 'Only a step that is waiting on its owner can be re-notified')
  const ownerRole = key === 'manager_exit_approval' || key === 'knowledge_transfer' ? 'Manager' : stepOf(ctx, key)!.departmentName
  notifyRole(ownerRole, approval.id, `Reminder — offboarding: ${humanizeStepName(key)} still needed for ${ctx.name}`)
  recordWorkflowEvent({ workflowId, stepKey: key, action: 're_notified', detail: { ownerRole }, performedBy: hrUserId })
  return { ok: true }
}

// ---------- Step 2: manager decision ----------

function managerApproval(ctx: OffboardingContext, key: 'manager_exit_approval' | 'knowledge_transfer', userId: string): Approval | OffboardingError {
  const approval = approvalOf(ctx, key)
  if (!approval) return 'wrong_state'
  if (approval.approverId && approval.approverId !== userId) return 'not_allowed'
  if (approval.status !== 'allocated') return 'wrong_state'
  return approval
}

export function managerExitDecision(workflowId: string, managerUserId: string, input: { decision: unknown; comment: unknown }): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const approval = managerApproval(ctx, 'manager_exit_approval', managerUserId)
  if (typeof approval === 'string') return fail(approval)
  const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
  if (input.decision === 'approved') {
    runInTransaction(() => {
      updateApprovalStatus(approval.id, 'completed', { completedBy: managerUserId, completedAt: new Date().toISOString() })
      recordDecision({ workflowId, stepKey: 'manager_exit_approval', approvalId: approval.id, decision: 'approved', comment: comment || null, decidedBy: managerUserId })
      notifyRole('HR', approval.id, `${ctx.name}'s exit was approved by their manager — ready for HR`)
    })
    return { ok: true }
  }
  if (input.decision === 'sent_back') {
    if (!comment) return fail('invalid_input', 'A comment is required to send this back')
    runInTransaction(() => {
      recordDecision({ workflowId, stepKey: 'manager_exit_approval', approvalId: approval.id, decision: 'sent_back', comment, decidedBy: managerUserId })
      notifyRole('HR', approval.id, `Manager sent ${ctx.name}'s exit back: ${comment}`)
    })
    return { ok: true }
  }
  return fail('invalid_input', 'Choose approve or send back')
}

// ---------- Step 3: HR exit approval ----------

export async function generateHrExitPrecheck(workflowId: string, hrUserId: string, generate?: NarrativeGenerator): Promise<Result> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const step = stepOf(ctx, 'hr_exit_approval')
  const state = stepState(workflowId, 'hr_exit_approval')
  if (!step || !state) return fail('step_not_found')
  if (state.locked) return fail('step_locked')
  const existing = approvalOf(ctx, 'hr_exit_approval')
  if (existing && existing.status !== 'allocated') return fail('wrong_state')
  const log = await runOffboardingReview('hr_exit_approval', workflowId, hrUserId, generate)
  runInTransaction(() => {
    const approval = existing ?? createApproval({ workflowId, stepId: step.id, approverId: hrUserId, status: 'allocated' })
    createStepAiSummary({ workflowId, stepId: step.id, approvalId: approval.id, stepKey: 'hr_exit_approval', summaryText: log.shortSummary, generatedAt: log.generatedAt })
    createAiVerificationRun({ id: log.runId, workflowId, stepKey: 'hr_exit_approval', approvalId: approval.id, result: log, generatedBy: hrUserId })
  })
  return { ok: true }
}

/** HR's Approve = the department sign-off + HR verification in one (HR owns this step). Gated like
 * every structured review: a flagged pre-check needs the acknowledgement + comment. */
export async function hrExitApprove(workflowId: string, hrUserId: string, input: { acknowledged?: unknown; comment?: unknown }): Promise<Result> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const step = stepOf(ctx, 'hr_exit_approval')!
  const approval = approvalOf(ctx, 'hr_exit_approval')
  if (!approval || approval.status !== 'allocated') return fail('wrong_state', 'Generate the AI pre-check first')
  const run = listAiVerificationRuns(approval.id, 'hr_exit_approval')[0]
  if (!run) return fail('wrong_state', 'Generate the AI pre-check first')
  const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
  if (!checkVerifyGate(run.overallStatus as AiLogOverallStatus, { acknowledged: input.acknowledged === true, comment }).ok) {
    return fail('review_required', "Tick \"I've reviewed the flagged issues\" and add a comment before approving")
  }
  runInTransaction(() => {
    updateApprovalStatus(approval.id, 'completed', { completedBy: hrUserId, completedAt: new Date().toISOString() })
    recordDecision({ workflowId, stepKey: 'hr_exit_approval', approvalId: approval.id, decision: 'approved', comment: comment || null, decidedBy: hrUserId })
  })
  const verified = await verifyStep(workflowId, step.id, hrUserId, comment || undefined)
  if (!verified.ok) return fail('wrong_state', verified.error)
  return { ok: true }
}

/** HR's Send back: the exit goes back to the reporting manager — the manager step (and with it this
 * one) is reverted, with HR's comment as the reason, so the manager decides again on re-notify. */
export async function hrExitSendBack(workflowId: string, hrUserId: string, input: { comment?: unknown }): Promise<Result> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const approval = approvalOf(ctx, 'hr_exit_approval')
  if (!approval || approval.status !== 'allocated') return fail('wrong_state')
  const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
  if (!comment) return fail('invalid_input', 'A comment is required to send this back')
  const managerStep = stepOf(ctx, 'manager_exit_approval')!
  const reverted = await revertStep(workflowId, managerStep.id, hrUserId, `HR sent the exit back: ${comment}`)
  if (!reverted.ok) return fail('wrong_state', reverted.error)
  recordDecision({ workflowId, stepKey: 'hr_exit_approval', approvalId: approval.id, decision: 'sent_back', comment, decidedBy: hrUserId })
  notifyRole('Manager', null, `HR sent ${ctx.name}'s exit back: ${comment}`)
  return { ok: true }
}

// ---------- Step 4: knowledge transfer ----------

export function confirmHandover(workflowId: string, employeeUserId: string, input: { notes: unknown }): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  if (!isWorkflowEmployee(ctx, employeeUserId)) return fail('not_allowed')
  const plan = getActiveHandoverPlan(workflowId)
  if (!plan || approvalOf(ctx, 'knowledge_transfer')?.status !== 'allocated') return fail('wrong_state', 'There is no handover waiting on you')
  if (plan.managerAcceptedAt) return fail('wrong_state', 'Your manager has already accepted the handover')
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (!notes) return fail('invalid_input', 'Handover notes cannot be empty')
  confirmHandoverByEmployee(plan.id, notes.slice(0, 10_000))
  const approval = approvalOf(ctx, 'knowledge_transfer')!
  notifyRole('Manager', approval.id, `${ctx.name} confirmed their handover notes — ready for you to accept`)
  return { ok: true }
}

/** Manager accepts: every handed-over item's ownership moves to its new owner, logged per item. */
export async function acceptHandover(workflowId: string, managerUserId: string): Promise<Result> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const approval = managerApproval(ctx, 'knowledge_transfer', managerUserId)
  if (typeof approval === 'string') return fail(approval)
  const plan = getActiveHandoverPlan(workflowId)
  if (!plan) return fail('wrong_state', 'No handover plan')
  if (!plan.employeeConfirmedAt) return fail('wrong_state', 'The employee has not confirmed their handover notes yet')

  // documents.json lives outside sqlite, so ownership moves first; each move is logged with the old
  // owner, which is exactly what Revert restores.
  const docs = await listDocuments()
  const moved: { itemType: string; itemRef: string; itemLabel: string; oldOwner: string; newOwner: string }[] = []
  for (const item of plan.items) {
    if (item.itemType !== 'kb_document') continue
    const doc = docs.find((d) => d.id === item.itemRef)
    if (!doc) continue
    const oldOwner = documentOwner(doc)
    if (oldOwner === item.newOwner) continue
    await setDocumentOwner(doc.id, item.newOwner)
    moved.push({ itemType: item.itemType, itemRef: item.itemRef, itemLabel: item.itemLabel, oldOwner, newOwner: item.newOwner })
  }
  runInTransaction(() => {
    for (const m of moved) recordOwnershipTransfer({ workflowId, ...m, transferredBy: managerUserId })
    acceptHandoverByManager(plan.id, managerUserId)
    updateApprovalStatus(approval.id, 'completed', { completedBy: managerUserId, completedAt: new Date().toISOString() })
    recordDecision({ workflowId, stepKey: 'knowledge_transfer', approvalId: approval.id, decision: 'approved', comment: null, decidedBy: managerUserId })
    recordWorkflowEvent({ workflowId, stepKey: 'knowledge_transfer', action: 'ownership_transferred', detail: { items: moved }, performedBy: managerUserId })
    notifyRole('HR', approval.id, `Knowledge transfer for ${ctx.name} accepted — ${moved.length} item(s) reassigned`)
  })
  return { ok: true }
}

// ---------- Step 6: asset recovery ----------

function assetApproval(ctx: OffboardingContext, userId: string): Approval | OffboardingError {
  const approval = approvalOf(ctx, 'asset_recovery')
  if (!approval || approval.status !== 'allocated') return 'wrong_state'
  const head = departmentHead(stepOf(ctx, 'asset_recovery')!.departmentName)
  if (approval.approverId && approval.approverId !== userId && head?.id !== userId) return 'not_allowed'
  return approval
}

export function markAsset(workflowId: string, userId: string, input: { itemId: unknown; status: unknown; notes: unknown }): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const approval = assetApproval(ctx, userId)
  if (typeof approval === 'string') return fail(approval)
  const item = listAssetReturnItems(workflowId).find((i) => i.id === input.itemId)
  if (!item) return fail('invalid_input', 'Unknown asset')
  if (input.status !== 'returned' && input.status !== 'missing') return fail('invalid_input', 'Mark the asset returned or missing')
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 500) : null
  runInTransaction(() => {
    markAssetReturnItem(item.id, input.status as 'returned' | 'missing', notes, userId)
    // Returned assets go back to the pool; missing ones are flagged. The prior status is kept on
    // the return line, so Revert restores it.
    setAssetStatus(item.assetId, input.status === 'returned' ? 'available' : 'missing')
  })
  return { ok: true }
}

export function completeAssetRecovery(workflowId: string, userId: string): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const approval = assetApproval(ctx, userId)
  if (typeof approval === 'string') return fail(approval)
  const items = listAssetReturnItems(workflowId)
  const pending = items.filter((i) => i.status === 'pending')
  if (pending.length > 0) return fail('wrong_state', `Mark every asset first (${pending.length} still pending)`)
  const missing = items.filter((i) => i.status === 'missing')
  runInTransaction(() => {
    updateApprovalStatus(approval.id, 'completed', { completedBy: userId, completedAt: new Date().toISOString() })
    notifyRole('HR', approval.id, `Asset recovery for ${ctx.name} done${missing.length ? ` — ${missing.length} missing item(s) passed to Finance Settlement` : ''}`)
  })
  return { ok: true }
}

// ---------- Step 9: exit completed ----------

export function completionBlockers(workflowId: string): string[] {
  return listWorkflowStepDetails(workflowId)
    .filter((s) => s.stepName !== 'exit_completed' && s.approval?.status !== 'verified')
    .map((s) => humanizeStepName(s.stepName))
}

export function markExitComplete(workflowId: string, hrUserId: string): Result {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const step = stepOf(ctx, 'exit_completed')
  if (!step) return fail('step_not_found')
  if (approvalOf(ctx, 'exit_completed')) return fail('wrong_state', 'The exit is already complete')
  const blockers = completionBlockers(workflowId)
  if (blockers.length > 0) return fail('blocked', `Still waiting on: ${blockers.join(', ')}`)

  const now = new Date().toISOString()
  runInTransaction(() => {
    if (ctx.user) {
      setUserActive(ctx.user.id, false)
      upsertAccessAction({ workflowId, system: 'app_login_final', targetRef: ctx.user.id, description: 'App login deactivated at exit completion', action: 'deactivated', externalRef: null, effectiveDate: now.slice(0, 10), createdBy: hrUserId })
    }
    for (const action of listAccessActions(workflowId, true)) {
      if ((action.system === 'sso' || action.system === 'email') && action.externalRef) directoryService().complete(action.externalRef)
    }
    createApproval({ workflowId, stepId: step.id, approverId: hrUserId, status: 'verified', completedBy: hrUserId, completedAt: now, verifiedBy: hrUserId, verifiedAt: now })
    updateWorkflowCurrentStep(workflowId, null, 'completed')
    recordWorkflowEvent({ workflowId, stepKey: 'exit_completed', action: 'exit_completed', detail: { loginDeactivated: !!ctx.user, exitDetails: exitDetailsFor(ctx) }, performedBy: hrUserId })
    for (const role of ['IT', 'Finance', 'Legal', 'Manager']) notifyRole(role, null, `${ctx.name} has been fully offboarded`)
  })
  return { ok: true }
}

/** Every step, in order — re-exported for routes and views. */
export const STEPS = OFFBOARDING_STEPS
export { getApproval, OFFBOARDING_REVIEW_OWNER }

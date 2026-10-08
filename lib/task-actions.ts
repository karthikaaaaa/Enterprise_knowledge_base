import {
  listSubtasksByApproval,
  getSubtaskById,
  updateSubtaskStatus,
  updateApprovalStatus,
  runInTransaction,
  getEmployeeDetailSubmissionByWorkflow,
  listAllWorkflows,
  createManagerApprovalReport,
  getWorkflow,
  getEmployeeById,
  getUserById,
  createItAccountReport,
  getLatestStepAiSummary,
  listAiVerificationRuns,
  recordAiVerificationRunReview,
  createNotification,
  getRoleByName,
  type StepAiSummaryKey,
  type SubtaskStatus,
  type ApprovalStatus,
  type Subtask,
} from '@/lib/workflow-store'
import { getTaskOwnership } from '@/lib/task-view'
import { createTeamAssignmentReport } from '@/lib/manager-approval-report'
import { createItAccountCredentialsReport } from '@/lib/it-account-report'
import { checkVerifyGate, type AiLogOverallStatus } from '@/lib/ai-verification-log'
import { humanizeStepName } from '@/lib/workflow-format'

export type TaskActionError = 'approval_not_found' | 'subtask_not_found' | 'approval_locked' | 'has_subtasks' | 'not_adhoc'

export type ManagerReportError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'subtask_not_found' | 'not_ready'

/** Approval status is always derived from subtask completion — recomputing from scratch handles both checking and unchecking symmetrically. */
function recomputeApprovalStatus(approvalId: string): Exclude<ApprovalStatus, 'pending' | 'verified'> {
  const subtasks = listSubtasksByApproval(approvalId)
  const completedCount = subtasks.filter((s) => s.status === 'completed').length
  if (subtasks.length > 0 && completedCount === subtasks.length) return 'completed'
  if (completedCount === 0) return 'allocated'
  return 'in_progress'
}

/** Writes an approval's status and keeps completed_by/completed_at in sync with it — stamped with
 * the acting user when the status lands on 'completed', cleared when it doesn't (e.g. a department
 * unchecks a subtask, dropping a previously-completed approval back to 'in_progress'). */
function applyApprovalStatus(approvalId: string, status: Exclude<ApprovalStatus, 'pending' | 'verified'>, actingUserId: string) {
  if (status === 'completed') {
    updateApprovalStatus(approvalId, status, { completedBy: actingUserId, completedAt: new Date().toISOString() })
  } else {
    updateApprovalStatus(approvalId, status, { clearCompletion: true })
  }
}

export function setSubtaskStatus(
  approvalId: string,
  subtaskId: string,
  status: SubtaskStatus,
  actingUserId: string,
): { ok: true; approvalStatus: ApprovalStatus; subtasks: Subtask[] } | { ok: false; error: TaskActionError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }

  const subtask = getSubtaskById(subtaskId)
  if (!subtask || subtask.approvalId !== approvalId) return { ok: false, error: 'subtask_not_found' }

  const result = runInTransaction(() => {
    updateSubtaskStatus(subtaskId, status, status === 'completed' ? actingUserId : null)
    const approvalStatus = recomputeApprovalStatus(approvalId)
    applyApprovalStatus(approvalId, approvalStatus, actingUserId)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId) }
  })

  return { ok: true, ...result }
}

/** Fallback for ad-hoc tasks with no subtasks — a plain "Mark Complete" toggle instead of a
 * checklist. Refused for template steps: the ones with no subtasks (the AI-summary steps below)
 * must go through their own summary-gated action, never this unguarded toggle. */
export function setApprovalStatusDirect(
  approvalId: string,
  status: 'completed' | 'allocated',
  actingUserId: string,
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: TaskActionError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  if (!ownership.step.isAdhoc) return { ok: false, error: 'not_adhoc' }
  if (listSubtasksByApproval(approvalId).length > 0) return { ok: false, error: 'has_subtasks' }

  applyApprovalStatus(approvalId, status, actingUserId)
  return { ok: true, approvalStatus: status }
}

// manager_approval's 2-item checklist, both special (neither is a plain checkbox):
//   1. Review — IT triggers the AI report; it must be visible before approving.
//   2. Approve — a plain confirmation once the report above has been reviewed.
export const MANAGER_REVIEW_SUBTASK_TITLE = 'Review team, start date & reporting structure'
export const MANAGER_APPROVE_SUBTASK_TITLE = 'Approve team & reporting assignment'

function ensureManagerApprovalOwnership(
  approvalId: string,
): { ok: true; ownership: NonNullable<ReturnType<typeof getTaskOwnership>> } | { ok: false; error: ManagerReportError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.step.stepName !== 'manager_approval') return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  return { ok: true, ownership }
}

/** IT-triggered: compiles the AI team/date/reporting-structure report (grounded in the employee's
 * own submitted details plus real existing teammates in the same department, never fabricated)
 * and marks the "Review" item complete. This must happen — and be reviewed — before "Approve" is
 * available; approveManagerAssignment below refuses to run until this report exists. */
export async function generateManagerAssignmentReport(
  approvalId: string,
  actingUserId: string,
): Promise<
  | { ok: true; approvalStatus: ApprovalStatus; subtasks: Subtask[]; report: ReturnType<typeof createManagerApprovalReport> }
  | { ok: false; error: ManagerReportError }
> {
  const check = ensureManagerApprovalOwnership(approvalId)
  if (!check.ok) return check
  const { ownership } = check

  const subtask = listSubtasksByApproval(approvalId).find((s) => s.title === MANAGER_REVIEW_SUBTASK_TITLE)
  if (!subtask) return { ok: false, error: 'subtask_not_found' }

  const workflowId = ownership.approval.workflowId
  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  if (!submission) return { ok: false, error: 'not_ready' }

  const teammates: string[] = []
  for (const workflow of listAllWorkflows()) {
    if (workflow.id === workflowId) continue
    const otherSubmission = getEmployeeDetailSubmissionByWorkflow(workflow.id)
    if (otherSubmission && otherSubmission.department === submission.department) {
      teammates.push(otherSubmission.fullName)
    }
  }

  const { markdown, summary } = await createTeamAssignmentReport({
    fullName: submission.fullName,
    roleTitle: submission.roleTitle,
    department: submission.department,
    startDate: submission.startDate,
    teammates,
  })

  const generatedAt = new Date().toISOString()

  const result = runInTransaction(() => {
    const report = createManagerApprovalReport({
      workflowId,
      stepId: ownership.step.id,
      markdown,
      summary,
      teamName: submission.department,
      startDate: submission.startDate,
      roleTitle: submission.roleTitle,
      generatedBy: actingUserId,
      generatedAt,
    })
    updateSubtaskStatus(subtask.id, 'completed', actingUserId)
    const approvalStatus = recomputeApprovalStatus(approvalId)
    applyApprovalStatus(approvalId, approvalStatus, actingUserId)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId), report }
  })

  return { ok: true, ...result }
}

/** IT-triggered: confirms the report generateManagerAssignmentReport produced. No AI call here —
 * this only completes the "Approve" checklist item, and only once THIS approval's own "Review"
 * item is done — checked via the subtask itself, not just "does any report exist for the
 * workflow," since an older cycle's report can otherwise linger after a reset/re-notify and
 * wrongly satisfy the check. */
export function approveManagerAssignment(
  approvalId: string,
  actingUserId: string,
): { ok: true; approvalStatus: ApprovalStatus; subtasks: Subtask[] } | { ok: false; error: ManagerReportError } {
  const check = ensureManagerApprovalOwnership(approvalId)
  if (!check.ok) return check

  const subtasks = listSubtasksByApproval(approvalId)
  const subtask = subtasks.find((s) => s.title === MANAGER_APPROVE_SUBTASK_TITLE)
  if (!subtask) return { ok: false, error: 'subtask_not_found' }

  const reviewSubtask = subtasks.find((s) => s.title === MANAGER_REVIEW_SUBTASK_TITLE)
  if (!reviewSubtask || reviewSubtask.status !== 'completed') return { ok: false, error: 'not_ready' }

  const result = runInTransaction(() => {
    updateSubtaskStatus(subtask.id, 'completed', actingUserId)
    const approvalStatus = recomputeApprovalStatus(approvalId)
    applyApprovalStatus(approvalId, approvalStatus, actingUserId)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId) }
  })

  return { ok: true, ...result }
}

export type ItAccountReportError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'subtask_not_found' | 'not_ready'

// it_account_creation's 2-item checklist, mirroring manager_approval's shape exactly — neither
// item is a plain checkbox: "Review" runs the AI account/credentials summary (now including a
// temporary password, not just the email); "Approve" only ever completes once that summary exists.
export const IT_REVIEW_SUBTASK_TITLE = 'Review account & login credentials'
export const IT_APPROVE_SUBTASK_TITLE = 'Approve account creation'

function ensureItAccountOwnership(
  approvalId: string,
): { ok: true; ownership: NonNullable<ReturnType<typeof getTaskOwnership>> } | { ok: false; error: ItAccountReportError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.step.stepName !== 'it_account_creation') return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  return { ok: true, ownership }
}

/** Compiles the AI account/credentials summary (grounded in the employee's real, already-issued
 * login email; the temporary password is this demo's own placeholder, always shown with a
 * "change on first login" note) and marks the "Review" item complete. This must happen — and be
 * reviewed — before "Approve" is available; approveItAccountCreation below refuses to run until
 * this report exists. */
export async function generateItAccountCredentials(
  approvalId: string,
  actingUserId: string,
): Promise<
  | { ok: true; approvalStatus: ApprovalStatus; subtasks: Subtask[]; report: ReturnType<typeof createItAccountReport> }
  | { ok: false; error: ItAccountReportError }
> {
  const check = ensureItAccountOwnership(approvalId)
  if (!check.ok) return check
  const { ownership } = check

  const subtask = listSubtasksByApproval(approvalId).find((s) => s.title === IT_REVIEW_SUBTASK_TITLE)
  if (!subtask) return { ok: false, error: 'subtask_not_found' }

  const workflowId = ownership.approval.workflowId
  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  const workflow = getWorkflow(workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  const loginUser = employee ? getUserById(employee.userId) : null
  if (!submission || !loginUser) return { ok: false, error: 'not_ready' }

  const { markdown, summary } = await createItAccountCredentialsReport({
    fullName: submission.fullName,
    email: loginUser.email,
    roleTitle: submission.roleTitle,
    department: submission.department,
  })

  const generatedAt = new Date().toISOString()

  const result = runInTransaction(() => {
    const report = createItAccountReport({
      workflowId,
      stepId: ownership.step.id,
      markdown,
      summary,
      email: loginUser.email,
      generatedBy: actingUserId,
      generatedAt,
    })
    updateSubtaskStatus(subtask.id, 'completed', actingUserId)
    const approvalStatus = recomputeApprovalStatus(approvalId)
    applyApprovalStatus(approvalId, approvalStatus, actingUserId)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId), report }
  })

  return { ok: true, ...result }
}

/** Confirms the summary generateItAccountCredentials produced. No AI call here — this only
 * completes the "Approve" checklist item, and only once THIS approval's own "Review" item is
 * done (checked via the subtask itself, same reasoning as approveManagerAssignment above). */
export function approveItAccountCreation(
  approvalId: string,
  actingUserId: string,
): { ok: true; approvalStatus: ApprovalStatus; subtasks: Subtask[] } | { ok: false; error: ItAccountReportError } {
  const check = ensureItAccountOwnership(approvalId)
  if (!check.ok) return check

  const subtasks = listSubtasksByApproval(approvalId)
  const subtask = subtasks.find((s) => s.title === IT_APPROVE_SUBTASK_TITLE)
  if (!subtask) return { ok: false, error: 'subtask_not_found' }

  const reviewSubtask = subtasks.find((s) => s.title === IT_REVIEW_SUBTASK_TITLE)
  if (!reviewSubtask || reviewSubtask.status !== 'completed') return { ok: false, error: 'not_ready' }

  const result = runInTransaction(() => {
    updateSubtaskStatus(subtask.id, 'completed', actingUserId)
    const approvalStatus = recomputeApprovalStatus(approvalId)
    applyApprovalStatus(approvalId, approvalStatus, actingUserId)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId) }
  })

  return { ok: true, ...result }
}

export type SimpleApprovalError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'not_ready'

/** asset_allocation, it_verification, finance_verification and legal_verification all have no
 * subtask checklist — a single AI-generated summary (produced up front, on Notify, see
 * workflow-actions.ts) that the owning department head reviews and confirms with one button
 * ("Approve" for Diego's two, "Verify" for Fatima's and Lucas's). This just flips the approval to
 * 'completed' — HR's own Verify on the timeline is still required afterward to reach 'verified' —
 * refusing only if the summary the button depends on doesn't exist yet. That should never happen
 * in practice (Notify always generates it before the task becomes visible), but guards against an
 * approval that predates this feature, and for it_verification doubles as its precondition guard
 * (see maybeGenerateItVerificationSummary in workflow-actions.ts). */
function completeAiSummaryStep(
  approvalId: string,
  actingUserId: string,
  stepKeys: StepAiSummaryKey[],
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: SimpleApprovalError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  const stepKey = stepKeys.find((key) => key === ownership.step.stepName)
  if (!stepKey) return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  if (!getLatestStepAiSummary(ownership.approval.workflowId, stepKey)) return { ok: false, error: 'not_ready' }

  applyApprovalStatus(approvalId, 'completed', actingUserId)
  return { ok: true, approvalStatus: 'completed' }
}

export function approveAssetAllocation(approvalId: string, actingUserId: string) {
  return completeAiSummaryStep(approvalId, actingUserId, ['asset_allocation'])
}

export function approveItVerification(approvalId: string, actingUserId: string) {
  return completeAiSummaryStep(approvalId, actingUserId, ['it_verification'])
}

/** The department head's own one-time "Verify" on their Tasks card (Fatima / Lucas) — sets
 * 'completed', NOT 'verified'. Distinct from HR's separate Verify on the combined timeline (see
 * verifyStep in workflow-actions.ts), which is still required after this. */
/** Steps whose department Verify is backed by a structured AI review log (lib/ai-verification-log.ts)
 * rather than a plain prose summary. */
const STRUCTURED_REVIEW_STEPS = new Set([
  'finance_verification',
  'legal_verification',
  // Offboarding's department-verified automated steps (lib/offboarding/reviews.ts).
  'it_access_deactivation',
  'finance_settlement',
  'legal_clearance',
])

export type DepartmentVerifyError = SimpleApprovalError | 'review_required' | 'rerun_required'
export type DepartmentReviewInput = { acknowledged?: boolean; comment?: string | null }

/** The department head's one-time "Verify" on their Tasks card. For legal_verification this is
 * unchanged. For finance_verification it also checks the latest structured run: a flagged run
 * (needs_attention / blocked) needs the "reviewed the flagged issues" acknowledgement plus a
 * comment, a run that was sent back must be re-run first, and the review is recorded on the run. */
export function verifyDepartmentSummaryStep(
  approvalId: string,
  actingUserId: string,
  review: DepartmentReviewInput = {},
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: DepartmentVerifyError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership || !STRUCTURED_REVIEW_STEPS.has(ownership.step.stepName)) {
    return completeAiSummaryStep(approvalId, actingUserId, ['finance_verification', 'legal_verification'])
  }

  const latestRun = listAiVerificationRuns(approvalId, ownership.step.stepName)[0]
  if (!latestRun) return { ok: false, error: 'not_ready' }
  if (latestRun.reviewAction === 'sent_back') return { ok: false, error: 'rerun_required' }
  if (!checkVerifyGate(latestRun.overallStatus as AiLogOverallStatus, review).ok) return { ok: false, error: 'review_required' }

  const comment = review.comment?.trim() || null
  return runInTransaction(() => {
    const result = completeAiSummaryStep(approvalId, actingUserId, [ownership.step.stepName as StepAiSummaryKey])
    if (result.ok) recordAiVerificationRunReview(latestRun.id, { action: 'verified', comment, reviewedBy: actingUserId })
    return result
  })
}

export type SendBackError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'not_ready' | 'comment_required' | 'rerun_required'

/** "Send back" on a structured review: records the reviewer's (required) comment on the latest run
 * and notifies HR. The approval stays where it is — the department re-runs the AI once HR has
 * addressed the comment, and that new run is what they then verify. */
export function sendBackDepartmentReview(
  approvalId: string,
  actingUserId: string,
  comment: string,
): { ok: true; runId: string } | { ok: false; error: SendBackError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (!STRUCTURED_REVIEW_STEPS.has(ownership.step.stepName)) return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'completed' || ownership.approval.status === 'verified') {
    return { ok: false, error: 'approval_locked' }
  }
  const trimmed = comment.trim()
  if (!trimmed) return { ok: false, error: 'comment_required' }
  const latestRun = listAiVerificationRuns(approvalId, ownership.step.stepName)[0]
  if (!latestRun) return { ok: false, error: 'not_ready' }
  if (latestRun.reviewAction === 'sent_back') return { ok: false, error: 'rerun_required' }

  const workflow = getWorkflow(ownership.approval.workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'the employee'
  const hrRole = getRoleByName('HR')
  runInTransaction(() => {
    recordAiVerificationRunReview(latestRun.id, { action: 'sent_back', comment: trimmed, reviewedBy: actingUserId })
    if (hrRole) {
      createNotification({
        roleId: hrRole.id,
        approvalId,
        message: `${humanizeStepName(ownership.step.stepName)} for ${employeeName} was sent back: ${trimmed}`,
      })
    }
  })
  return { ok: true, runId: latestRun.id }
}

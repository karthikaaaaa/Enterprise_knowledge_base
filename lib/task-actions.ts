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
  getLatestAssetAllocationSummary,
  getLatestItVerificationSummary,
  type SubtaskStatus,
  type ApprovalStatus,
  type Subtask,
} from '@/lib/workflow-store'
import { getTaskOwnership } from '@/lib/task-view'
import { createTeamAssignmentReport } from '@/lib/manager-approval-report'
import { createItAccountCredentialsReport } from '@/lib/it-account-report'

export type TaskActionError = 'approval_not_found' | 'subtask_not_found' | 'approval_locked' | 'has_subtasks'

export type ManagerReportError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'subtask_not_found' | 'not_ready'

/** Approval status is always derived from subtask completion — recomputing from scratch handles both checking and unchecking symmetrically. */
function recomputeApprovalStatus(approvalId: string): Exclude<ApprovalStatus, 'pending' | 'verified'> {
  const subtasks = listSubtasksByApproval(approvalId)
  const completedCount = subtasks.filter((s) => s.status === 'completed').length
  if (subtasks.length > 0 && completedCount === subtasks.length) return 'completed'
  if (completedCount === 0) return 'allocated'
  return 'in_progress'
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
    updateApprovalStatus(approvalId, approvalStatus)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId) }
  })

  return { ok: true, ...result }
}

/** Fallback for ad-hoc tasks with no subtasks — a plain "Mark Complete" toggle instead of a checklist. */
export function setApprovalStatusDirect(
  approvalId: string,
  status: 'completed' | 'allocated',
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: TaskActionError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  if (listSubtasksByApproval(approvalId).length > 0) return { ok: false, error: 'has_subtasks' }

  updateApprovalStatus(approvalId, status)
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
    updateApprovalStatus(approvalId, approvalStatus)
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
    updateApprovalStatus(approvalId, approvalStatus)
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
    updateApprovalStatus(approvalId, approvalStatus)
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
    updateApprovalStatus(approvalId, approvalStatus)
    return { approvalStatus, subtasks: listSubtasksByApproval(approvalId) }
  })

  return { ok: true, ...result }
}

export type SimpleApprovalError = 'approval_not_found' | 'wrong_step' | 'approval_locked' | 'not_ready'

/** asset_allocation and it_verification both have no subtask checklist at all — a single
 * AI-generated summary (produced up front, on Notify, see workflow-actions.ts) that Diego reviews
 * and confirms with one plain "Approve" button. This just flips the approval straight to
 * 'completed', refusing only if the summary the button depends on doesn't exist yet — that should
 * never happen in practice (Notify always generates it before the approval becomes visible), but
 * guards against the edge case of an approval that predates this feature. */
export function approveAssetAllocation(
  approvalId: string,
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: SimpleApprovalError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.step.stepName !== 'asset_allocation') return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  if (!getLatestAssetAllocationSummary(ownership.approval.workflowId)) return { ok: false, error: 'not_ready' }

  updateApprovalStatus(approvalId, 'completed')
  return { ok: true, approvalStatus: 'completed' }
}

/** Same shape as approveAssetAllocation above — it_verification's AI summary only exists once
 * both preconditions (it_account_creation and asset_allocation verified) are met, so "not_ready"
 * doubles as the guard for that too (see maybeGenerateItVerificationSummary in
 * workflow-actions.ts). */
export function approveItVerification(
  approvalId: string,
): { ok: true; approvalStatus: ApprovalStatus } | { ok: false; error: SimpleApprovalError } {
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) return { ok: false, error: 'approval_not_found' }
  if (ownership.step.stepName !== 'it_verification') return { ok: false, error: 'wrong_step' }
  if (ownership.approval.status === 'verified') return { ok: false, error: 'approval_locked' }
  if (!getLatestItVerificationSummary(ownership.approval.workflowId)) return { ok: false, error: 'not_ready' }

  updateApprovalStatus(approvalId, 'completed')
  return { ok: true, approvalStatus: 'completed' }
}

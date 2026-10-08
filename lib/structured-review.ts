import {
  getWorkflowSteps,
  getRoleByName,
  listAiVerificationRuns,
  createNotification,
  type Approval,
} from '@/lib/workflow-store'
import { getLatestApprovalForStep } from '@/lib/workflow-view'
import { rerunStructuredReview, type StructuredReviewStepKey } from '@/lib/workflow-actions'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'

/**
 * Shared plumbing for records a structured-review step creates (finance: payroll / expense /
 * sign-off pack; legal: confidentiality agreement / compliance sign-off pack): the "still waiting
 * on the department" guard, the run a record was created from, HR notifications, and the AI
 * re-run that follows every creation.
 */

export type RecordOptions = {
  generate?: NarrativeGenerator
  /** Runs the AI re-run after the response (routes pass Next's `after`); omitted, it's awaited. */
  defer?: (task: () => Promise<void>) => void
}

export type RerunOutcome = 'done' | 'skipped' | 'scheduled'

/** The step's latest approval, only while it's still waiting on its department. */
export function approvalAwaiting(workflowId: string, stepKey: StructuredReviewStepKey): Approval | null {
  const step = getWorkflowSteps(workflowId).find((s) => s.stepName === stepKey)
  const approval = step ? getLatestApprovalForStep(workflowId, step.id) : null
  return approval && approval.status !== 'completed' && approval.status !== 'verified' ? approval : null
}

export function latestRunIdFor(approvalId: string, stepKey: StructuredReviewStepKey): string | null {
  return listAiVerificationRuns(approvalId, stepKey)[0]?.id ?? null
}

export function notifyRoleAbout(roleName: string, approvalId: string | null, message: string) {
  const role = getRoleByName(roleName)
  if (role) createNotification({ roleId: role.id, approvalId, message })
}

export async function rerunAfter(
  workflowId: string,
  stepKey: StructuredReviewStepKey,
  userId: string,
  options: RecordOptions,
): Promise<RerunOutcome> {
  const rerun = async () => (await rerunStructuredReview(workflowId, stepKey, userId, options.generate)).ok
  if (options.defer) {
    options.defer(async () => void (await rerun()))
    return 'scheduled'
  }
  return (await rerun()) ? 'done' : 'skipped'
}

import {
  getWorkflow,
  getWorkflowSteps,
  listApprovalsByWorkflow,
  updateWorkflowCurrentStep,
  runInTransaction,
  deleteApprovalsForStep,
  deleteEmployeeDetailSubmissionsForWorkflow,
  deleteEmployeeDocumentsForWorkflow,
  deleteDocumentVerificationResultsForWorkflow,
  deleteHrApprovalProfileEntriesForWorkflow,
  deleteManagerApprovalReportsForWorkflow,
  deleteItAccountReportsForWorkflow,
  deleteEmployeeKbGrantsForWorkflow,
  deleteFinanceVerificationArtifactsForWorkflow,
  deleteLegalVerificationArtifactsForWorkflow,
  listHrApprovalProfileEntriesForWorkflow,
  resetApprovalFields,
  resetSubtasksForApproval,
  deleteNotificationsForApproval,
  createWorkflowAuditLogEntry,
  type WorkflowStep,
  type Approval,
} from '@/lib/workflow-store'
import { listWorkflowStepDetails, type WorkflowStepDetail } from '@/lib/workflow-view'
import { retractKbDocument } from '@/lib/hr-approval-kb'
import { humanizeStepName } from '@/lib/workflow-format'
import {
  isOffboardingStepKey,
  undoOffboardingStep,
  undoOffboardingStepOutsideDb,
  notifyOffboardingRevert,
} from '@/lib/offboarding/revert'

export type RevertError = 'workflow_not_found' | 'step_not_found' | 'not_started' | 'revert_failed'

export type RevertResult =
  { ok: true; steps: WorkflowStepDetail[]; cascadedStepNames: string[] } | { ok: false; error: RevertError; failedAt?: string }

/** The step being reverted plus every step after it, in timeline order, that has already been
 * started (has an approval row) — stops at the first still-pending step, since strict top-to-bottom
 * locking means nothing past that point could have been started either. Returns null if `stepId`
 * isn't on this workflow. */
function computeCascadeTargets(
  workflowId: string,
  stepId: string,
): { steps: WorkflowStep[]; latest: Map<string, Approval> } | null {
  const steps = getWorkflowSteps(workflowId)
  const index = steps.findIndex((s) => s.id === stepId)
  if (index === -1) return null

  const latest = new Map(listApprovalsByWorkflow(workflowId).map((a) => [a.stepId, a] as const))

  const targets: WorkflowStep[] = [steps[index]]
  for (let i = index + 1; i < steps.length; i++) {
    if (!latest.get(steps[i].id)) break
    targets.push(steps[i])
  }

  return { steps: targets, latest }
}

/**
 * Reverts `stepId` and cascades forward through every already-started step after it — clearing
 * each step's data, resetting its approval back to "never started" (deleted outright for template
 * steps, reset in place for ad-hoc ones so they stay allocated rather than disappearing), and
 * pointing the workflow's current step back at the reverted one. HR/Administrator-only, gated by
 * ENABLE_STEP_DEV_CONTROLS — see the route.
 */
export async function revertStep(
  workflowId: string,
  stepId: string,
  performedByUserId: string,
  /** Why HR is reverting — recorded in the audit log. Optional. */
  reason: string | null = null,
): Promise<RevertResult> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const cascade = computeCascadeTargets(workflowId, stepId)
  if (!cascade) return { ok: false, error: 'step_not_found' }
  const { steps: targets, latest } = cascade

  const targetStep = targets[0]
  if (!latest.get(targetStep.id)) return { ok: false, error: 'not_started' }

  // Names the exact operation in flight, so a failure logs "<step>: <table/operation>" instead of
  // surfacing as a bare 500. Updated before every write below.
  let stage = 'start'
  const fail = (error: unknown): RevertResult => {
    console.error(
      `[revert] workflow=${workflowId} step=${targetStep.stepName} cascade=[${targets.map((s) => s.stepName).join(', ')}] failed at: ${stage}`,
      error,
    )
    return { ok: false, error: 'revert_failed', failedAt: stage }
  }

  // Deleting the Knowledge Base entry(ies) hr_approval generated touches the filesystem and the
  // chunks store, not workflows.db — do this before the sqlite transaction below deletes the
  // hr_approval_profile_entries rows that are the only record of which KB documents to remove.
  // No entries (hr_approval never generated one) is simply an empty loop.
  try {
    if (targets.some((s) => s.stepName === 'hr_approval')) {
      for (const entry of listHrApprovalProfileEntriesForWorkflow(workflowId)) {
        stage = `hr_approval: retract KB document ${entry.documentId} (documents.json / storage/documents / chunks.db)`
        await retractKbDocument(entry.documentId)
      }
    }
    // Offboarding changes outside sqlite (knowledge-transfer document ownership) go back first too.
    for (const step of targets) {
      if (!isOffboardingStepKey(step.stepName)) continue
      stage = `${step.stepName}: undo changes outside workflows.db`
      await undoOffboardingStepOutsideDb(workflowId, step.stepName)
    }
  } catch (error) {
    return fail(error)
  }

  try {
    runInTransaction(() => {
      for (const step of targets) {
        stage = `${step.stepName}: delete step data`
        switch (step.stepName) {
          case 'employee_details':
            deleteEmployeeDetailSubmissionsForWorkflow(workflowId)
            break
          case 'upload_documents':
            // Uploaded files live inline in employee_documents.file_data (base64), not as separate
            // files on disk — deleting the rows is the whole cleanup.
            deleteEmployeeDocumentsForWorkflow(workflowId)
            break
          case 'ai_document_verification':
            deleteDocumentVerificationResultsForWorkflow(workflowId)
            break
          case 'hr_approval':
            deleteHrApprovalProfileEntriesForWorkflow(workflowId)
            break
          case 'manager_approval':
            deleteManagerApprovalReportsForWorkflow(workflowId)
            break
          case 'it_account_creation':
            deleteItAccountReportsForWorkflow(workflowId)
            break
          case 'finance_verification':
            // Payroll entry, expense account, sign-off pack, and the employee's bank/tax details +
            // the requests for them — so Finance Verification starts over from scratch.
            deleteFinanceVerificationArtifactsForWorkflow(workflowId)
            break
          case 'legal_verification':
            // The issued (and possibly signed) confidentiality agreement and the compliance
            // sign-off pack — Legal re-issues and the employee re-signs on the redo.
            deleteLegalVerificationArtifactsForWorkflow(workflowId)
            break
          case 'knowledge_base_access':
            // Takes the Employee's Knowledge Base access back with it (see lib/kb-access.ts).
            deleteEmployeeKbGrantsForWorkflow(workflowId)
            break
          default:
            // Offboarding steps restore their soft changes (access, payroll/expense end-dates,
            // asset statuses, ownership, login) — see lib/offboarding/revert.ts.
            if (isOffboardingStepKey(step.stepName)) {
              undoOffboardingStep(workflowId, step.stepName, performedByUserId)
              break
            }
            // The AI-summary steps (asset_allocation, it_verification)
            // and every department step's subtasks are approval-scoped, not workflow-scoped —
            // deleteApprovalsForStep below already clears them.
            break
        }

        stage = step.isAdhoc
          ? `${step.stepName}: reset ad-hoc approval`
          : `${step.stepName}: delete approvals + notifications/subtasks/step_ai_summaries`
        if (step.isAdhoc) {
          // Ad-hoc steps stay in place on revert rather than vanishing — the department just redoes
          // the work, no re-Notify needed from HR.
          const approval = latest.get(step.id)
          if (approval) {
            deleteNotificationsForApproval(approval.id)
            resetSubtasksForApproval(approval.id)
            resetApprovalFields(approval.id, 'allocated')
          }
        } else {
          // deleteApprovalsForStep also clears notifications/subtasks/AI-summary rows tied to any
          // approval this step has ever had (not just the latest), so the row deletion alone is the
          // full cleanup here.
          deleteApprovalsForStep(workflowId, step.id)
        }
      }

      stage = 'workflows: reset current_step_id/status'
      updateWorkflowCurrentStep(workflowId, targetStep.id, workflow.status === 'completed' ? 'in_progress' : undefined)

      stage = 'workflow_audit_log: insert'
      createWorkflowAuditLogEntry({
        workflowId,
        stepKey: targetStep.stepName,
        action: 'revert',
        performedBy: performedByUserId,
        cascadedStepKeys: targets.map((s) => s.stepName),
        reason,
      })
    })
  } catch (error) {
    // runInTransaction already rolled back — nothing in workflows.db changed.
    return fail(error)
  }

  if (workflow.type === 'offboarding') {
    notifyOffboardingRevert(
      workflowId,
      targets.map((s) => s.stepName),
      targets.map((s) => s.departmentName),
      reason,
      // Departments that still had the task open on their Tasks page (now removed with the approval).
      targets.filter((s) => latest.get(s.id)?.status === 'allocated').map((s) => s.departmentName),
    )
  }

  return {
    ok: true,
    steps: listWorkflowStepDetails(workflowId),
    cascadedStepNames: targets.slice(1).map((s) => humanizeStepName(s.stepName)),
  }
}

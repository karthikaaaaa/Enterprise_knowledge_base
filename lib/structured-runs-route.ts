import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getWorkflowSteps, getUserById, listAiVerificationRuns, listAiVerificationRunsForWorkflowStep, type AiVerificationRun } from '@/lib/workflow-store'
import { getLatestApprovalForStep } from '@/lib/workflow-view'
import { resolveStructuredLogView, toHrSummary, validateAiVerificationLog } from '@/lib/ai-verification-log'
import { rerunStructuredReview, type RerunStructuredReviewError, type StructuredReviewStepKey } from '@/lib/workflow-actions'

/** Shared GET/POST behind each structured step's `/runs` route (finance_verification,
 * legal_verification). GET: the owning department gets the full log + history; HR/Administrator get
 * the short summary (or the read-only full log with ?view=full); everyone else 403. POST: "Re-run AI"
 * for the owning department or HR/Administrator. */

export type StructuredRunsConfig = {
  stepKey: StructuredReviewStepKey
  taskIds: readonly string[]
  /** Role name of the department that owns the step — 'Finance' / 'Legal'. */
  ownerRole: string
  /** Step-specific extra fields merged into the GET response (e.g. finance's info request). */
  extra?: (workflowId: string) => Record<string, unknown>
  /** 'workflow': the history also lists runs from earlier, reverted rounds of the step (flagged
   * beforeRevert). Default 'approval' keeps the current round only, as before. */
  historyScope?: 'approval' | 'workflow'
}

const RERUN_ERROR_STATUS: Record<RerunStructuredReviewError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_notified: 400,
  already_verified: 409,
}

function reviewOf(run: AiVerificationRun) {
  if (!run.reviewAction) return null
  return {
    action: run.reviewAction,
    comment: run.reviewComment,
    reviewedBy: run.reviewedBy ? (getUserById(run.reviewedBy)?.name ?? 'Unknown user') : null,
    reviewedAt: run.reviewedAt,
  }
}

export async function handleStructuredRunsGet(request: Request, workflowId: string, config: StructuredRunsConfig) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const view = resolveStructuredLogView(config.ownerRole, caller.role.name, new URL(request.url).searchParams.get('view'))
  if (!view) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!getWorkflow(workflowId)) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  const step = getWorkflowSteps(workflowId).find((s) => s.stepName === config.stepKey)
  const approval = step ? getLatestApprovalForStep(workflowId, step.id) : null
  const runs = approval ? listAiVerificationRuns(approval.id, config.stepKey) : []
  const extra = config.extra?.(workflowId) ?? {}
  if (runs.length === 0) {
    return NextResponse.json({ view, approvalStatus: approval?.status ?? null, latest: null, review: null, history: [], ...extra })
  }

  const parsed = validateAiVerificationLog(runs[0].result, config.taskIds)
  if (!parsed.ok) {
    console.error(`[${config.stepKey}-runs] stored run ${runs[0].id} failed validation:`, parsed.errors)
    return NextResponse.json({ error: 'The latest AI run could not be read — re-run the AI to regenerate it.' }, { status: 500 })
  }

  return NextResponse.json({
    view,
    approvalStatus: approval?.status ?? null,
    latest: view === 'full' ? parsed.value : toHrSummary(parsed.value),
    review: reviewOf(runs[0]),
    ...extra,
    history:
      view === 'full'
        ? (config.historyScope === 'workflow' ? listAiVerificationRunsForWorkflowStep(workflowId, config.stepKey) : runs).map((run) => ({
            runId: run.id,
            generatedAt: run.generatedAt,
            overallStatus: run.overallStatus,
            model: run.model,
            generatedBy: run.generatedBy ? (getUserById(run.generatedBy)?.name ?? 'Unknown user') : 'Notify (automatic)',
            review: reviewOf(run),
            ...(run.approvalId !== approval?.id ? { beforeRevert: true } : {}),
          }))
        : [],
  })
}

export async function handleStructuredRunsPost(request: Request, workflowId: string, config: StructuredRunsConfig) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = caller.role.name
  if (role !== config.ownerRole && role !== 'HR' && role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const result = await rerunStructuredReview(workflowId, config.stepKey, caller.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: RERUN_ERROR_STATUS[result.error] })
  return NextResponse.json({ runId: result.runId })
}

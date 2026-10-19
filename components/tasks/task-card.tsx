'use client'

import { useState, type ReactNode } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { ChevronDown, Loader2, Sparkles, ShieldCheck, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPatch, authedPost } from '@/lib/api-client'
import type { TaskItem } from '@/lib/task-view'
import type { Subtask } from '@/lib/workflow-store'
import type { AiVerificationLog } from '@/lib/ai-verification-log'
import {
  AiReviewDecision,
  AiReviewLog,
  openAuthedLink,
  type AiReviewInfo,
  type AiRunHistoryItem,
} from '@/components/verification/ai-review-log'
import { InfoRequestStatus, type InfoRequestSummary } from '@/components/verification/info-request'
import { PayrollEntryPanel } from '@/components/verification/payroll-entry'
import { ExpenseAccountPanel, SignoffPackPanel } from '@/components/verification/finance-record-panels'
import { AgreementPanel, LegalSignoffPanel } from '@/components/verification/legal-record-panels'
import { FinalPayPanel } from '@/components/offboarding/final-pay-panel'
import { LegalClearancePanel } from '@/components/offboarding/legal-clearance-panel'
import { AssetRecoveryTask, ManagerExitTask, ManagerHandoverTask } from '@/components/offboarding/offboarding-tasks'

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  allocated: { label: 'Allocated', badge: 'bg-secondary text-muted-foreground' },
  in_progress: { label: 'In Progress', badge: 'bg-yellow-soft text-yellow-ink' },
  completed: { label: 'Completed — awaiting HR verification', badge: 'bg-accent text-blue-ink' },
}

/** Per-step label overrides for the status pill — display only, the underlying status is unchanged. */
const STEP_STATUS_LABELS: Record<string, Partial<Record<string, string>>> = {
  finance_verification: { allocated: 'Awaiting Finance Verification' },
  legal_verification: { allocated: 'Awaiting Legal Verification' },
  manager_exit_approval: { allocated: 'Awaiting Manager Approval' },
  knowledge_transfer: { allocated: 'Awaiting Handover' },
  it_access_deactivation: { allocated: 'Awaiting IT Verification' },
  asset_recovery: { allocated: 'Awaiting Asset Recovery' },
  finance_settlement: { allocated: 'Awaiting Finance Verification' },
  legal_clearance: { allocated: 'Awaiting Legal Verification' },
}

/** manager_approval's and it_account_creation's checklists share the same 2-item "review, then
 * approve" shape — neither item is a plain checkbox. "Review" runs the relevant AI summary;
 * "Approve" only ever completes once that summary exists (see task-actions.ts for both). */
const MANAGER_REVIEW_SUBTASK_TITLE = 'Review team, start date & reporting structure'
const MANAGER_APPROVE_SUBTASK_TITLE = 'Approve team & reporting assignment'
const IT_REVIEW_SUBTASK_TITLE = 'Review account & login credentials'
const IT_APPROVE_SUBTASK_TITLE = 'Approve account creation'

type ManagerApprovalReport = { markdown: string; summary: string; teamName: string; startDate: string; roleTitle: string; generatedAt: string }
type ItAccountReport = { markdown: string; summary: string; email: string; generatedAt: string }
type SimpleSummary = { summaryText: string; generatedAt: string }

export function TaskCard({
  task,
  onUpdated,
}: {
  task: TaskItem
  onUpdated: (patch: Partial<TaskItem>) => void
}) {
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const hasSubtasks = task.subtasks.total > 0
  const { data, mutate, isLoading } = useSWR<{ subtasks: Subtask[] }>(
    expanded && hasSubtasks ? `/api/tasks/${task.approvalId}/subtasks` : null,
    authedFetcher(user?.email),
  )

  const isManagerApprovalTask = task.stepName === 'manager_approval'
  const managerReviewSubtask = data?.subtasks.find((s) => s.title === MANAGER_REVIEW_SUBTASK_TITLE)
  const managerApproveSubtask = data?.subtasks.find((s) => s.title === MANAGER_APPROVE_SUBTASK_TITLE)
  const { data: managerReportData, mutate: mutateManagerReport } = useSWR<{ report: ManagerApprovalReport }>(
    expanded && isManagerApprovalTask && managerReviewSubtask?.status === 'completed'
      ? `/api/workflows/${task.workflowId}/steps/manager_approval/report`
      : null,
    authedFetcher(user?.email),
  )

  const isItAccountCreationTask = task.stepName === 'it_account_creation'
  const itReviewSubtask = data?.subtasks.find((s) => s.title === IT_REVIEW_SUBTASK_TITLE)
  const itApproveSubtask = data?.subtasks.find((s) => s.title === IT_APPROVE_SUBTASK_TITLE)
  const { data: itCredentialsData, mutate: mutateItCredentials } = useSWR<{ report: ItAccountReport }>(
    expanded && isItAccountCreationTask && itReviewSubtask?.status === 'completed'
      ? `/api/workflows/${task.workflowId}/steps/it_account_creation/credentials`
      : null,
    authedFetcher(user?.email),
  )

  // asset_allocation and it_verification have no subtask checklist at all — the AI summary is
  // generated up front (on Notify, or once it_verification's preconditions are met) rather than by
  // a "Review" click here, so this just fetches whatever summary already exists and shows one
  // "Approve" button, no checkbox.
  const isAssetAllocationTask = task.stepName === 'asset_allocation'
  const { data: assetSummaryData } = useSWR<{ summary: SimpleSummary }>(
    expanded && isAssetAllocationTask ? `/api/workflows/${task.workflowId}/steps/asset_allocation/summary` : null,
    authedFetcher(user?.email),
  )

  const isItVerificationTask = task.stepName === 'it_verification'
  const { data: itVerificationSummaryData } = useSWR<{ summary: SimpleSummary }>(
    expanded && isItVerificationTask ? `/api/workflows/${task.workflowId}/steps/it_verification/summary` : null,
    authedFetcher(user?.email),
  )

  // finance_verification (Fatima) and legal_verification (Lucas): same summary-only shape as the two
  // above, but the single button reads "Verify" — the department head's own one-time sign-off,
  // which only moves the task to 'completed'. HR's separate Verify on the timeline still follows.
  const isDepartmentVerificationTask = task.stepName === 'finance_verification' || task.stepName === 'legal_verification'
  // Both now have a structured review panel (StructuredReviewTask below); the plain-summary
  // fallback is kept for any other department-verification step.
  const isStructuredReviewTask = STRUCTURED_REVIEW_STEPS.has(task.stepName)
  const { data: departmentSummaryData } = useSWR<{ summary: SimpleSummary }>(
    expanded && isDepartmentVerificationTask && !isStructuredReviewTask
      ? `/api/workflows/${task.workflowId}/steps/${task.stepName}/summary`
      : null,
    authedFetcher(user?.email),
  )

  const baseConfig = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.allocated
  const config = { ...baseConfig, label: STEP_STATUS_LABELS[task.stepName]?.[task.status] ?? baseConfig.label }

  function applySubtaskResult(result: { approvalStatus: string; subtasks: Subtask[] }) {
    onUpdated({
      status: result.approvalStatus,
      subtasks: {
        completed: result.subtasks.filter((s) => s.status === 'completed').length,
        total: result.subtasks.length,
      },
    })
  }

  async function toggleSubtask(subtaskId: string, checked: boolean) {
    setPendingId(subtaskId)
    setActionError(null)
    try {
      const result = await authedPatch<{ approvalStatus: string; subtasks: Subtask[] }>(
        `/api/tasks/${task.approvalId}/subtasks/${subtaskId}`,
        user?.email,
        { status: checked ? 'completed' : 'pending' },
      )
      await mutate({ subtasks: result.subtasks }, { revalidate: false })
      applySubtaskResult(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setPendingId(null)
    }
  }

  async function markComplete(nextStatus: 'completed' | 'allocated') {
    setPendingId('mark-complete')
    setActionError(null)
    try {
      const result = await authedPatch<{ approvalStatus: string }>(`/api/tasks/${task.approvalId}`, user?.email, {
        status: nextStatus,
      })
      onUpdated({ status: result.approvalStatus })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setPendingId(null)
    }
  }

  async function generateManagerReport() {
    if (!managerReviewSubtask) return
    setPendingId(managerReviewSubtask.id)
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string; subtasks: Subtask[]; report: ManagerApprovalReport }>(
        `/api/tasks/${task.approvalId}/manager-report`,
        user?.email,
      )
      await Promise.all([
        mutate({ subtasks: result.subtasks }, { revalidate: false }),
        mutateManagerReport({ report: result.report }, { revalidate: false }),
      ])
      applySubtaskResult(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setPendingId(null)
    }
  }

  async function approveManagerAssignment() {
    if (!managerApproveSubtask) return
    setPendingId(managerApproveSubtask.id)
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string; subtasks: Subtask[] }>(
        `/api/tasks/${task.approvalId}/manager-approve`,
        user?.email,
      )
      await mutate({ subtasks: result.subtasks }, { revalidate: false })
      applySubtaskResult(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setPendingId(null)
    }
  }

  async function generateItCredentials() {
    if (!itReviewSubtask) return
    setPendingId(itReviewSubtask.id)
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string; subtasks: Subtask[]; report: ItAccountReport }>(
        `/api/tasks/${task.approvalId}/it-credentials`,
        user?.email,
      )
      await Promise.all([
        mutate({ subtasks: result.subtasks }, { revalidate: false }),
        mutateItCredentials({ report: result.report }, { revalidate: false }),
      ])
      applySubtaskResult(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to generate credentials summary')
    } finally {
      setPendingId(null)
    }
  }

  async function approveItAccountCreation() {
    if (!itApproveSubtask) return
    setPendingId(itApproveSubtask.id)
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string; subtasks: Subtask[] }>(
        `/api/tasks/${task.approvalId}/it-approve`,
        user?.email,
      )
      await mutate({ subtasks: result.subtasks }, { revalidate: false })
      applySubtaskResult(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setPendingId(null)
    }
  }

  async function approveAssetAllocation() {
    setPendingId('approve')
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string }>(`/api/tasks/${task.approvalId}/asset-allocation-approve`, user?.email)
      onUpdated({ status: result.approvalStatus })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setPendingId(null)
    }
  }

  async function approveItVerification() {
    setPendingId('approve')
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string }>(`/api/tasks/${task.approvalId}/it-verification-approve`, user?.email)
      onUpdated({ status: result.approvalStatus })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setPendingId(null)
    }
  }

  async function verifyDepartmentSummary() {
    setPendingId('approve')
    setActionError(null)
    try {
      const result = await authedPost<{ approvalStatus: string }>(`/api/tasks/${task.approvalId}/department-verify`, user?.email)
      onUpdated({ status: result.approvalStatus })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to verify')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{task.stepTitle}</h3>
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', config.badge)}>
              {config.label}
            </span>
            {task.isAdhoc ? (
              <span className="rounded-full bg-blue px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">Custom</span>
            ) : null}
            {task.workflowType === 'offboarding' ? (
              <span className="rounded-full bg-yellow-soft px-2.5 py-0.5 text-[11px] font-semibold text-yellow-ink">Offboarding · {task.employee.name}</span>
            ) : null}
          </div>
          {task.stepDescription ? <p className="mt-1 text-xs text-muted-foreground">{task.stepDescription}</p> : null}
          {hasSubtasks ? (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {task.subtasks.completed}/{task.subtasks.total} complete
            </p>
          ) : null}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Expand task"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {isManagerApprovalTask ? (
            isLoading ? (
              <p className="text-xs text-muted-foreground">Loading checklist…</p>
            ) : (
              <ReviewThenApprove
                reviewSubtask={managerReviewSubtask}
                approveSubtask={managerApproveSubtask}
                pendingId={pendingId}
                onGenerate={generateManagerReport}
                onApprove={approveManagerAssignment}
                reviewLabel={MANAGER_REVIEW_SUBTASK_TITLE}
                approveLabel={MANAGER_APPROVE_SUBTASK_TITLE}
                reportPanel={managerReportData?.report ? <ManagerReportPanel report={managerReportData.report} /> : null}
              />
            )
          ) : isItAccountCreationTask ? (
            isLoading ? (
              <p className="text-xs text-muted-foreground">Loading checklist…</p>
            ) : (
              <ReviewThenApprove
                reviewSubtask={itReviewSubtask}
                approveSubtask={itApproveSubtask}
                pendingId={pendingId}
                onGenerate={generateItCredentials}
                onApprove={approveItAccountCreation}
                reviewLabel={IT_REVIEW_SUBTASK_TITLE}
                approveLabel={IT_APPROVE_SUBTASK_TITLE}
                reportPanel={itCredentialsData?.report ? <ItCredentialsPanel report={itCredentialsData.report} /> : null}
              />
            )
          ) : isAssetAllocationTask ? (
            <SimpleApprove
              summary={assetSummaryData?.summary ?? null}
              approved={task.status === 'completed'}
              pending={pendingId === 'approve'}
              onApprove={approveAssetAllocation}
              badgeLabel="Standard asset kit"
            />
          ) : isItVerificationTask ? (
            <SimpleApprove
              summary={itVerificationSummaryData?.summary ?? null}
              approved={task.status === 'completed'}
              pending={pendingId === 'approve'}
              onApprove={approveItVerification}
              badgeLabel="IT sign-off confirmation"
              waitingLabel="Waiting on IT Account Creation and Asset Allocation to be verified"
            />
          ) : task.workflowType === 'offboarding' && task.stepName === 'manager_exit_approval' ? (
            <ManagerExitTask workflowId={task.workflowId} status={task.status} onUpdated={onUpdated} />
          ) : task.workflowType === 'offboarding' && task.stepName === 'knowledge_transfer' ? (
            <ManagerHandoverTask workflowId={task.workflowId} status={task.status} onUpdated={onUpdated} />
          ) : task.workflowType === 'offboarding' && task.stepName === 'asset_recovery' ? (
            <AssetRecoveryTask workflowId={task.workflowId} status={task.status} onUpdated={onUpdated} />
          ) : isStructuredReviewTask ? (
            <StructuredReviewTask task={task} onUpdated={onUpdated} />
          ) : isDepartmentVerificationTask ? (
            <SimpleApprove
              summary={departmentSummaryData?.summary ?? null}
              approved={task.status === 'completed'}
              pending={pendingId === 'approve'}
              onApprove={verifyDepartmentSummary}
              badgeLabel={task.stepName === 'finance_verification' ? 'Finance pre-check' : 'Legal pre-check'}
              actionLabel="Verify"
              doneLabel="Verified — awaiting HR verification"
            />
          ) : hasSubtasks ? (
            isLoading ? (
              <p className="text-xs text-muted-foreground">Loading checklist…</p>
            ) : (
              (data?.subtasks ?? []).map((subtask) => (
                <label
                  key={subtask.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-secondary/60"
                >
                  <input
                    type="checkbox"
                    checked={subtask.status === 'completed'}
                    disabled={pendingId === subtask.id}
                    onChange={(e) => toggleSubtask(subtask.id, e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span
                    className={cn(
                      'text-sm text-foreground',
                      subtask.status === 'completed' && 'text-muted-foreground line-through',
                    )}
                  >
                    {subtask.title}
                  </span>
                  {pendingId === subtask.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : null}
                </label>
              ))
            )
          ) : (
            <button
              onClick={() => markComplete(task.status === 'completed' ? 'allocated' : 'completed')}
              disabled={pendingId === 'mark-complete'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
            >
              {pendingId === 'mark-complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {task.status === 'completed' ? 'Mark Incomplete' : 'Mark Complete'}
            </button>
          )}
          {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

type StructuredRunsResponse = {
  approvalStatus: string | null
  latest: AiVerificationLog | null
  review: AiReviewInfo | null
  history: AiRunHistoryItem[]
  infoRequest?: InfoRequestSummary | null
}

const REVIEW_ERROR_MESSAGES: Record<string, string> = {
  review_required: "Tick \"I've reviewed the flagged issues\" and add a comment before verifying.",
  rerun_required: 'This run was sent back — re-run the AI once HR has addressed it.',
  comment_required: 'A comment is required to send this back.',
  not_ready: 'The AI review has not been generated yet.',
  approval_locked: 'This task has already been completed.',
}

const STRUCTURED_REVIEW_STEPS = new Set([
  'finance_verification',
  'legal_verification',
  // Offboarding's AI-automated department steps (same panel; no extra record panels).
  'it_access_deactivation',
  'finance_settlement',
  'legal_clearance',
])

/** Fatima's finance_verification / Lucas's legal_verification panel: the full itemized AI log (with
 * evidence and run history), the records the step creates, 
 * then Verify / Send back. See lib/ai-verification-log.ts for what the log contains and why every
 * status and evidence row is computed from records rather than model text. */
function StructuredReviewTask({ task, onUpdated }: { task: TaskItem; onUpdated: (patch: Partial<TaskItem>) => void }) {
  const { user } = useAuth()
  const stepBase = `/api/workflows/${task.workflowId}/steps/${task.stepName}`
  const runsUrl = `${stepBase}/runs`
  const isFinance = task.stepName === 'finance_verification'
  const { data, error, isLoading, mutate } = useSWR<StructuredRunsResponse>(runsUrl, authedFetcher(user?.email))
  const [pending, setPending] = useState<'verify' | 'send_back' | 'rerun' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const completed = task.status === 'completed'

  async function run(kind: 'verify' | 'send_back' | 'rerun', action: () => Promise<void>) {
    setPending(kind)
    setActionError(null)
    try {
      await action()
      await mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      setActionError(REVIEW_ERROR_MESSAGES[message] ?? message)
    } finally {
      setPending(null)
    }
  }

  // Each created record can unblock the next (e.g. payroll + expense -> sign-off pack), so refresh
  // every draft for this step now, and the AI log a few times while its background re-run lands.
  const { mutate: mutateGlobal } = useSWRConfig()
  function refreshAfterCreate() {
    void mutateGlobal((key) => typeof key === 'string' && key.startsWith(`${stepBase}/`))
    ;[4000, 10000, 20000, 40000, 60000, 90000].forEach((ms) => setTimeout(() => void mutate(), ms))
  }

  const rerun = () => run('rerun', async () => void (await authedPost(runsUrl, user?.email)))
  const verify = (input: { acknowledged: boolean; comment: string }) =>
    run('verify', async () => {
      const result = await authedPost<{ approvalStatus: string }>(`/api/tasks/${task.approvalId}/department-verify`, user?.email, input)
      onUpdated({ status: result.approvalStatus })
    })
  const sendBack = (comment: string) =>
    run('send_back', async () => void (await authedPost(`/api/tasks/${task.approvalId}/send-back`, user?.email, { comment })))

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading AI review…</p>
  if (error) return <p className="text-xs font-medium text-destructive">{error.message}</p>

  const latest = data?.latest ?? null
  const sentBack = data?.review?.action === 'sent_back'
  return (
    <div className="space-y-3">
      {latest ? (
        <AiReviewLog
          log={latest}
          history={data?.history ?? []}
          review={data?.review ?? null}
          readOnly={completed}
          onRerun={rerun}
          rerunning={pending === 'rerun'}
          onOpenLink={(link) => openAuthedLink(link, user?.email)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">No AI review has been run for this task yet.</p>
          <button
            type="button"
            onClick={rerun}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending === 'rerun' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Run AI review
          </button>
        </div>
      )}

      {!completed && data?.infoRequest ? <InfoRequestStatus request={data.infoRequest} /> : null}

      {latest && isFinance ? (
        <>
          <PayrollEntryPanel workflowId={task.workflowId} readOnly={completed} onCreated={refreshAfterCreate} />
          <ExpenseAccountPanel workflowId={task.workflowId} readOnly={completed} onCreated={refreshAfterCreate} />
          <SignoffPackPanel workflowId={task.workflowId} readOnly={completed} onCreated={refreshAfterCreate} />
        </>
      ) : latest && task.stepName === 'legal_verification' ? (
        <>
          <AgreementPanel workflowId={task.workflowId} readOnly={completed} onCreated={refreshAfterCreate} />
          <LegalSignoffPanel workflowId={task.workflowId} readOnly={completed} onCreated={refreshAfterCreate} />
        </>
      ) : latest && task.stepName === 'finance_settlement' ? (
        <FinalPayPanel workflowId={task.workflowId} readOnly={completed} onSaved={refreshAfterCreate} />
      ) : latest && task.stepName === 'legal_clearance' ? (
        <LegalClearancePanel workflowId={task.workflowId} readOnly={completed} onSaved={refreshAfterCreate} />
      ) : null}

      {completed ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f8a52]">
          <Check className="h-3.5 w-3.5" />
          Verified — awaiting HR verification
        </p>
      ) : latest && sentBack ? (
        <p className="text-xs font-medium text-muted-foreground">Sent back to HR — re-run the AI once they&apos;ve addressed your comment.</p>
      ) : latest ? (
        <AiReviewDecision
          key={latest.runId}
          overallStatus={latest.overallStatus}
          pending={pending === 'verify' || pending === 'send_back' ? pending : null}
          onVerify={verify}
          onSendBack={sendBack}
        />
      ) : null}
      {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
    </div>
  )
}

/** Shared "AI summary, then one button" UI — used by asset_allocation and it_verification
 * ("Approve") and finance_verification / legal_verification ("Verify"), which all have identical
 * shapes: no subtask checklist at all, just a read-only summary generated up front (on Notify, or
 * once it_verification's own preconditions are met) and one plain button, no checkbox. `summary`
 * is null while there's nothing to show yet — for most steps that's only ever a brief instant
 * (Notify generates it before the task appears at all), but for it_verification it can be a real
 * wait, hence `waitingLabel`. */
function SimpleApprove({
  summary,
  approved,
  pending,
  onApprove,
  badgeLabel,
  waitingLabel,
  actionLabel = 'Approve',
  doneLabel = 'Approved',
}: {
  summary: SimpleSummary | null
  approved: boolean
  pending: boolean
  onApprove: () => void
  badgeLabel: string
  waitingLabel?: string
  actionLabel?: string
  doneLabel?: string
}) {
  if (!summary) {
    return <p className="text-xs text-muted-foreground">{waitingLabel ?? 'Generating summary…'}</p>
  }

  return (
    <>
      <div className="space-y-2 rounded-2xl bg-secondary/60 p-3">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">{badgeLabel}</span>
        <p className="text-sm leading-relaxed text-foreground">{summary.summaryText}</p>
      </div>

      {approved ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f8a52]">
          <Check className="h-3.5 w-3.5" />
          {doneLabel}
        </p>
      ) : (
        <button
          onClick={onApprove}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f8a52] px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {actionLabel}
        </button>
      )}
    </>
  )
}

/** Shared "review, then approve" checklist UI — used by both manager_approval and
 * it_account_creation, which have identical shapes: an AI-generate step that must be reviewed
 * before a plain approve step becomes available. */
function ReviewThenApprove({
  reviewSubtask,
  approveSubtask,
  pendingId,
  onGenerate,
  onApprove,
  reviewLabel,
  approveLabel,
  reportPanel,
}: {
  reviewSubtask?: Subtask
  approveSubtask?: Subtask
  pendingId: string | null
  onGenerate: () => void
  onApprove: () => void
  reviewLabel: string
  approveLabel: string
  reportPanel: ReactNode | null
}) {
  return (
    <>
      {reviewSubtask?.status === 'completed' && reportPanel ? (
        reportPanel
      ) : (
        <button
          onClick={onGenerate}
          disabled={pendingId === reviewSubtask?.id}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-blue-ink shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
        >
          {pendingId === reviewSubtask?.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {reviewLabel}
        </button>
      )}

      {reviewSubtask?.status === 'completed' ? (
        approveSubtask?.status === 'completed' ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f8a52]">
            <Check className="h-3.5 w-3.5" />
            Approved
          </p>
        ) : (
          <button
            onClick={onApprove}
            disabled={pendingId === approveSubtask?.id}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f8a52] px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {pendingId === approveSubtask?.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {approveLabel}
          </button>
        )
      ) : null}
    </>
  )
}

/** Same badge + summary + Markdown layout as the HR-approval employee-profile panel on the
 * Automation page — this is the IT-facing copy of the same report. */
function ManagerReportPanel({ report }: { report: ManagerApprovalReport }) {
  return (
    <div className="space-y-3 rounded-2xl bg-secondary/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
          Team, start date &amp; reporting structure
        </span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 text-xs leading-relaxed text-foreground">
        {report.markdown}
      </pre>
    </div>
  )
}

/** Same layout again — this one only reaches the employee's own login once HR verifies too. */
function ItCredentialsPanel({ report }: { report: ItAccountReport }) {
  return (
    <div className="space-y-3 rounded-2xl bg-secondary/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
          Account &amp; access confirmed
        </span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 text-xs leading-relaxed text-foreground">
        {report.markdown}
      </pre>
    </div>
  )
}

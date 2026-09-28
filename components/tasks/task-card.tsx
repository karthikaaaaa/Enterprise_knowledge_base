'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { ChevronDown, Loader2, Sparkles, ShieldCheck, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPatch, authedPost } from '@/lib/api-client'
import type { TaskItem } from '@/lib/task-view'
import type { Subtask } from '@/lib/workflow-store'

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  allocated: { label: 'Allocated', badge: 'bg-secondary text-muted-foreground' },
  in_progress: { label: 'In Progress', badge: 'bg-yellow-soft text-yellow-ink' },
  completed: { label: 'Completed — awaiting HR verification', badge: 'bg-accent text-blue-ink' },
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

  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.allocated

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

/** Shared "AI summary, then approve" UI — used by both asset_allocation and it_verification,
 * which have identical shapes: no subtask checklist at all, just a read-only summary generated
 * up front (on Notify, or once it_verification's own preconditions are met) and one plain
 * "Approve" button, no checkbox. `summary` is null while there's nothing to show yet — for
 * asset_allocation that's only ever a brief instant (Notify generates it before the task appears
 * at all), but for it_verification it can be a real wait, hence `waitingLabel`. */
function SimpleApprove({
  summary,
  approved,
  pending,
  onApprove,
  badgeLabel,
  waitingLabel,
}: {
  summary: SimpleSummary | null
  approved: boolean
  pending: boolean
  onApprove: () => void
  badgeLabel: string
  waitingLabel?: string
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
          Approved
        </p>
      ) : (
        <button
          onClick={onApprove}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f8a52] px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Approve
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

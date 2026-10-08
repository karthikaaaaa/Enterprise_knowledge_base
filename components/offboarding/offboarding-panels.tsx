'use client'

import { useState, type ReactNode } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { ArrowRight, Bell, Check, ClipboardList, Loader2, LogOut, Package, Sparkles, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'
import type { AiLogHrSummary, AiVerificationLog } from '@/lib/ai-verification-log'
import {
  AiReviewDecision,
  AiReviewLog,
  AiReviewShortSummary,
  openAuthedLink,
  type AiReviewInfo,
  type AiRunHistoryItem,
} from '@/components/verification/ai-review-log'
import { EmployeeExitDetailsForm, HrExitDetailsRequest, type ExitDetailsRequestSummary } from '@/components/offboarding/exit-details-request'
import type { ExitDetailFieldKey } from '@/lib/offboarding/exit-detail-fields'

/** Offboarding UI (lib/offboarding/*). HR's per-step panels on the timeline, the manager picker,
 * and the exiting employee's own action card. */

// ---------- data ----------

type ExitSourceInfo = { source: 'employee' | 'hr' | 'system'; by: string | null; at: string }
type ExitDetailHistoryEntry = { action: string; detail: Record<string, unknown>; performedBy: string | null; performedAt: string }
type EmployeeExitRequest = { id: string; fields: ExitDetailFieldKey[]; message: string | null; requestedBy: string; requestedAt: string }

type DecisionInfo = { decision: 'approved' | 'sent_back'; comment: string | null; decidedBy: string; decidedAt: string } | null

export type OffboardingState = {
  viewer: 'hr' | 'manager' | 'it' | 'finance' | 'legal' | 'employee'
  employee?: { name: string; department: string | null }
  exitDetails: {
    exitType?: string
    lastWorkingDay: string | null
    reason?: string | null
    noticeStartDate?: string | null
    forwardingContact?: string | null
    lwdConfirmedBy?: string | null
    lwdConfirmedAt?: string | null
    sources?: Partial<Record<string, ExitSourceInfo>>
    noticePeriodDays?: number | null
  }
  /** HR: the latest "Request details from employee". Employee: the open one, if any. */
  exitDetailsRequest?: ExitDetailsRequestSummary | EmployeeExitRequest | null
  requestableExitFields?: ExitDetailFieldKey[]
  exitDetailHistory?: ExitDetailHistoryEntry[]
  manager?: { id: string; name: string } | null
  managerCandidates?: { id: string; name: string }[]
  managerDecision?: DecisionInfo
  hrDecision?: DecisionInfo
  handover?: {
    draftNotes: string
    employeeNotes: string | null
    employeeConfirmedAt?: string | null
    confirmedAt?: string | null
    managerAcceptedAt?: string | null
    model?: string
    items: { label: string; newOwner: string; currentOwner?: string; type?: string }[]
  } | null
  transfers?: { label: string; oldOwner: string; newOwner: string; transferredBy: string; transferredAt: string; revertedAt: string | null }[]
  assets?: { id?: string; name: string; serial: string | null; status: string; notes?: string | null; type?: string | null }[]
  accessActions?: { system: string; description: string; action: string; status: string; effectiveDate: string | null; createdAt: string }[]
  settlement?: { updatedAt?: string; processed?: boolean; processedAt?: string | null } | null
  completion?: { blockers: string[]; completed: boolean }
}

export function offboardingStateKey(workflowId: string) {
  return `/api/workflows/${workflowId}/offboarding`
}

export function useOffboardingState(workflowId: string, enabled = true) {
  const { user } = useAuth()
  return useSWR<OffboardingState>(user && enabled ? offboardingStateKey(workflowId) : null, authedFetcher(user?.email))
}

/** Refreshes everything that can change after an offboarding action (state, workflow, runs). */
export function useRefreshOffboarding(workflowId: string) {
  const { mutate } = useSWRConfig()
  return () => mutate((key) => typeof key === 'string' && key.startsWith(`/api/workflows/${workflowId}`))
}

export function useOffboardingAction(workflowId: string) {
  const { user } = useAuth()
  const refresh = useRefreshOffboarding(workflowId)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run(action: string, body: Record<string, unknown> = {}) {
    setPending(action)
    setError(null)
    try {
      await authedPost(`/api/workflows/${workflowId}/offboarding/${action}`, user?.email, body)
      await refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      return false
    } finally {
      setPending(null)
    }
  }
  return { run, pending, error, setError }
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-soft transition-all duration-200 disabled:pointer-events-none disabled:opacity-50'
const inputCls = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'

function Note({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad'; title: string; children?: ReactNode }) {
  const tones = {
    neutral: 'bg-secondary text-muted-foreground',
    good: 'bg-[#e3f4ea] text-[#1f8a52]',
    warn: 'bg-yellow-soft text-yellow-ink',
    bad: 'bg-destructive/10 text-destructive',
  }
  return (
    <div className={cn('rounded-2xl px-4 py-3', tones[tone].split(' ')[0])}>
      <p className={cn('text-[11px] font-semibold uppercase tracking-wide', tones[tone].split(' ')[1])}>{title}</p>
      {children ? <div className="mt-1 text-sm text-foreground">{children}</div> : null}
    </div>
  )
}

function DecisionNote({ label, decision }: { label: string; decision: DecisionInfo | undefined }) {
  if (!decision) return null
  return (
    <Note tone={decision.decision === 'approved' ? 'good' : 'bad'} title={`${label} ${decision.decision === 'approved' ? 'approved' : 'sent back'} by ${decision.decidedBy} · ${formatDateTime(decision.decidedAt)}`}>
      {decision.comment ? `“${decision.comment}”` : null}
    </Note>
  )
}

// ---------- HR panels ----------

const SOURCE_LABEL: Record<ExitSourceInfo['source'], string> = { employee: 'Employee-submitted', hr: 'HR-entered', system: 'System' }

function SourceTag({ src }: { src: ExitSourceInfo | undefined }) {
  if (!src) return null
  return (
    <span className="ml-1.5 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      {SOURCE_LABEL[src.source]}
      {src.by ? ` · ${src.by}` : ''} · {formatDateTime(src.at)}
    </span>
  )
}

const FIELD_LABEL: Record<string, string> = {
  exitType: 'Exit type',
  reason: 'Reason',
  lastWorkingDay: 'Last working day',
  noticeStartDate: 'Notice start date',
  forwardingContact: 'Forwarding contact',
}

function describeHistoryEntry(entry: ExitDetailHistoryEntry) {
  const d = entry.detail as { field?: string; old?: string | null; new?: string | null; source?: string; lastWorkingDay?: string; fields?: string[] }
  switch (entry.action) {
    case 'exit_detail_changed':
      return `${FIELD_LABEL[d.field ?? ''] ?? d.field}: ${d.old ?? '—'} → ${d.new ?? '—'}${d.source === 'employee' ? ' (employee)' : ''}`
    case 'last_working_day_confirmed':
      return `Last working day ${d.lastWorkingDay} confirmed`
    case 'exit_details_cleared':
      return 'Exit details cleared (Exit Initiated reverted)'
    case 'exit_details_requested':
      return `Details requested from the employee`
    case 'exit_details_re_notified':
      return 'Employee re-notified'
    default:
      return entry.action.replace(/_/g, ' ')
  }
}

function ExitDetailsPanel({ workflowId, state, editable, editLabel }: { workflowId: string; state: OffboardingState; editable: boolean; editLabel?: string }) {
  const d = state.exitDetails
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [exitType, setExitType] = useState(d.exitType === 'termination' ? 'termination' : 'resignation')
  const [lwd, setLwd] = useState(d.lastWorkingDay ?? '')
  const [reason, setReason] = useState(d.reason ?? '')
  const [noticeStart, setNoticeStart] = useState(d.noticeStartDate ?? '')
  const [contact, setContact] = useState(d.forwardingContact ?? '')
  const [confirmLwd, setConfirmLwd] = useState(false)
  const { run, pending, error } = useOffboardingAction(workflowId)
  const sources = d.sources ?? {}
  const today = new Date().toISOString().slice(0, 10)

  function startEditing() {
    setExitType(d.exitType === 'termination' ? 'termination' : 'resignation')
    setLwd(d.lastWorkingDay ?? '')
    setReason(d.reason ?? '')
    setNoticeStart(d.noticeStartDate ?? '')
    setContact(d.forwardingContact ?? '')
    setConfirmLwd(!!d.lwdConfirmedAt)
    setEditing(true)
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-2xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-foreground">
            Exit type (HR only)
            <select value={exitType} onChange={(e) => setExitType(e.target.value)} className={inputCls}>
              <option value="resignation">Resignation</option>
              <option value="termination">Termination</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-foreground">
            Last working day
            <input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-foreground">
            Notice start date
            <input type="date" value={noticeStart} onChange={(e) => setNoticeStart(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-foreground">
            Forwarding contact
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Personal email or phone" className={inputCls} />
          </label>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required for a termination)" className={inputCls} />
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={confirmLwd} onChange={(e) => setConfirmLwd(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
          <span>
            Confirm this as the final last working day
            {lwd && lwd < today ? <span className="block text-xs text-muted-foreground">It is in the past — confirming records it as accepted, not an issue.</span> : null}
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={async () =>
              (await run('exit-details', {
                exit_type: exitType,
                last_working_day: lwd,
                reason,
                notice_start_date: noticeStart,
                forwarding_contact: contact,
                confirm_last_working_day: confirmLwd,
              })) && setEditing(false)
            }
            className={cn(btn, 'bg-primary text-primary-foreground')}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save exit details
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-3 text-xs font-semibold text-muted-foreground">
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </div>
    )
  }
  const history = state.exitDetailHistory ?? []
  return (
    <div className="space-y-2 rounded-2xl bg-secondary/60 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p>
            <span className="font-semibold">Exit type:</span> {d.exitType === 'not_recorded' || !d.exitType ? 'Not recorded yet' : d.exitType}
            <SourceTag src={sources.exitType} />
          </p>
          <p>
            <span className="font-semibold">Last working day:</span> {d.lastWorkingDay ?? 'Not set'}
            {d.noticePeriodDays != null ? <span className="text-muted-foreground"> · {d.noticePeriodDays}-day notice</span> : null}
            <SourceTag src={sources.lastWorkingDay} />
            {d.lwdConfirmedAt ? (
              <span className="ml-1.5 rounded-full bg-[#e3f4ea] px-2 py-0.5 text-[10px] font-semibold text-[#1f8a52]">
                Confirmed by {d.lwdConfirmedBy ?? 'HR'}
              </span>
            ) : null}
          </p>
          <p>
            <span className="font-semibold">Notice start date:</span> {d.noticeStartDate ?? 'Not recorded'}
            <SourceTag src={sources.noticeStartDate} />
          </p>
          <p>
            <span className="font-semibold">Reason:</span> {d.reason ?? 'Not recorded'}
            <SourceTag src={sources.reason} />
          </p>
          <p>
            <span className="font-semibold">Forwarding contact:</span> {d.forwardingContact ?? 'Not recorded'}
            <SourceTag src={sources.forwardingContact} />
          </p>
        </div>
        {editable ? (
          <button type="button" onClick={startEditing} className={cn(btn, 'bg-card text-foreground')}>
            {editLabel ?? (d.exitType === 'not_recorded' ? 'Record exit details' : 'Edit exit details')}
          </button>
        ) : null}
      </div>
      {history.length > 0 ? (
        <div>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs font-semibold text-blue-ink hover:underline">
            {showHistory ? 'Hide change history' : `Change history (${history.length})`}
          </button>
          {showHistory ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {history.map((h, i) => (
                <li key={i}>
                  {formatDateTime(h.performedAt)} · {h.performedBy ?? 'System'} — {describeHistoryEntry(h)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RenotifyButton({ workflowId, stepKey }: { workflowId: string; stepKey: string }) {
  const { run, pending, error } = useOffboardingAction(workflowId)
  const [sent, setSent] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={pending !== null} onClick={async () => setSent(await run('renotify', { step_key: stepKey }))} className={cn(btn, 'bg-card text-foreground')}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Re-notify
      </button>
      {sent ? <span className="text-xs text-[#1f8a52]">Reminder sent</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}

type RunsResponse = { latest: AiVerificationLog | null; review: AiReviewInfo | null; history: AiRunHistoryItem[] }

/** HR's view of an offboarding AI step: short summary, with the read-only full log on demand. */
function ReviewSummaryPanel({ workflowId, stepKey, badgeLabel }: { workflowId: string; stepKey: string; badgeLabel: string }) {
  const { user } = useAuth()
  const [showFull, setShowFull] = useState(false)
  const base = `/api/workflows/${workflowId}/steps/${stepKey}/runs`
  const { data: summary } = useSWR<{ latest: AiLogHrSummary | null; review: AiReviewInfo | null }>(user ? base : null, authedFetcher(user?.email))
  const { data: full } = useSWR<RunsResponse>(user && showFull ? `${base}?view=full` : null, authedFetcher(user?.email))
  if (!summary?.latest) return null
  return (
    <div className="space-y-2">
      <AiReviewShortSummary summary={summary.latest} review={summary.review} badgeLabel={badgeLabel} />
      <button type="button" onClick={() => setShowFull((v) => !v)} className="text-xs font-semibold text-blue-ink hover:underline">
        {showFull ? 'Hide full log' : 'Show full log (read-only)'}
      </button>
      {showFull && full?.latest ? (
        <AiReviewLog log={full.latest} history={full.history} review={full.review} readOnly onOpenLink={(link) => openAuthedLink(link, user?.email)} />
      ) : null}
    </div>
  )
}

/** Step 3: HR owns this one — generate the AI pre-check, then Approve or Send back. */
function HrExitApprovalPanel({ workflowId, approvalStatus, locked, state }: { workflowId: string; approvalStatus: string | null; locked: boolean; state: OffboardingState }) {
  const { user } = useAuth()
  const runsUrl = `/api/workflows/${workflowId}/steps/hr_exit_approval/runs`
  const { data, error: loadError, isLoading, mutate: reload } = useSWR<RunsResponse>(user && approvalStatus ? runsUrl : null, authedFetcher(user?.email))
  const { run, pending, error } = useOffboardingAction(workflowId)
  if (locked) return null
  if (!approvalStatus) {
    return (
      <div className="space-y-2">
        <button type="button" disabled={pending !== null} onClick={() => run('hr-precheck')} className={cn(btn, 'bg-primary text-primary-foreground')}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {pending ? 'AI processing…' : 'Generate AI pre-check'}
        </button>
        {error ? (
          <p className="text-xs font-medium text-destructive">
            {error} <button type="button" onClick={() => run('hr-precheck')} className="underline">Retry</button>
          </p>
        ) : null}
      </div>
    )
  }
  // Never spin forever: a failed fetch shows the error with Retry, and a step with no run yet
  // (e.g. the AI call failed part-way) offers to generate one.
  if (loadError) {
    return (
      <p className="text-xs font-medium text-destructive">
        Couldn&apos;t load the AI pre-check: {loadError instanceof Error ? loadError.message : 'request failed'}{' '}
        <button type="button" onClick={() => reload()} className="underline">
          Retry
        </button>
      </p>
    )
  }
  if (isLoading || !data) return <p className="text-xs text-muted-foreground">Loading AI pre-check…</p>
  if (!data.latest) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">No AI pre-check on record for this round yet.</p>
        <button type="button" disabled={pending !== null} onClick={() => run('hr-precheck')} className={cn(btn, 'bg-primary text-primary-foreground')}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {pending ? 'AI processing…' : 'Generate AI pre-check'}
        </button>
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </div>
    )
  }
  if (approvalStatus !== 'allocated') return <AiReviewLog log={data.latest} history={data.history} review={data.review} readOnly />
  return (
    <div className="space-y-3">
      <HrExitDetailsRequest
        // Re-mount when a new run changes what's requestable, so the pre-ticked fields stay current.
        key={`${data.latest.runId}:${(state.requestableExitFields ?? []).join(',')}`}
        request={(state.exitDetailsRequest as ExitDetailsRequestSummary | null | undefined) ?? null}
        requestableFields={state.requestableExitFields ?? []}
        isTermination={state.exitDetails.exitType === 'termination'}
        run={run}
        pending={pending}
      />
      <AiReviewLog log={data.latest} history={data.history} review={data.review} onRerun={() => run('hr-precheck')} rerunning={pending === 'hr-precheck'} />
      <AiReviewDecision
        key={data.latest.runId}
        overallStatus={data.latest.overallStatus}
        verifyLabel="Approve exit"
        pending={pending === 'hr-approve' ? 'verify' : pending === 'hr-send-back' ? 'send_back' : null}
        onVerify={({ acknowledged, comment }) => run('hr-approve', { acknowledged, comment })}
        onSendBack={(comment) => run('hr-send-back', { comment })}
      />
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

function HandoverReadOnly({ state }: { state: OffboardingState }) {
  const h = state.handover
  return (
    <div className="space-y-2">
      {h ? (
        <>
          <Note tone={h.managerAcceptedAt ? 'good' : h.employeeConfirmedAt ? 'neutral' : 'warn'} title={h.managerAcceptedAt ? 'Handover accepted by manager' : h.employeeConfirmedAt ? 'Employee confirmed — waiting on manager' : 'Waiting on the employee to confirm handover notes'}>
            {h.items.length === 0 ? 'No owned documents or open tasks on record.' : `${h.items.length} item(s) to hand over.`}
          </Note>
          {h.items.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {h.items.map((i) => (
                <li key={i.label} className="flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                  {i.label} <ArrowRight className="h-3 w-3" /> <span className="font-semibold">{i.newOwner}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {state.transfers && state.transfers.length > 0 ? (
        <div className="rounded-2xl border border-border p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reassignment log</p>
          <ul className="mt-1 space-y-1 text-xs">
            {state.transfers.map((t, i) => (
              <li key={i} className={t.revertedAt ? 'text-muted-foreground line-through' : ''}>
                {t.label}: {t.oldOwner} → {t.newOwner} · by {t.transferredBy}, {formatDateTime(t.transferredAt)}
                {t.revertedAt ? ` (reverted ${formatDateTime(t.revertedAt)})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function AccessActionsList({ state }: { state: OffboardingState }) {
  const actions = (state.accessActions ?? []).filter((a) => !['payroll', 'expense'].includes(a.system))
  if (actions.length === 0) return null
  return (
    <div className="rounded-2xl border border-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Access actions</p>
      <ul className="mt-1 space-y-1 text-xs">
        {actions.map((a, i) => (
          <li key={i} className={a.status === 'reverted' ? 'text-muted-foreground line-through' : ''}>
            {a.description}
            {a.effectiveDate ? ` · effective ${a.effectiveDate}` : ''} · {formatDateTime(a.createdAt)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AssetsReadOnly({ state }: { state: OffboardingState }) {
  const assets = state.assets ?? []
  if (assets.length === 0) return <Note title="No assets assigned in records" />
  return (
    <ul className="space-y-1 text-xs">
      {assets.map((a) => (
        <li key={a.id ?? a.name} className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          {a.name}
          {a.serial ? ` (${a.serial})` : ''} —{' '}
          <span className={cn('font-semibold', a.status === 'missing' ? 'text-destructive' : a.status === 'returned' ? 'text-[#1f8a52]' : 'text-muted-foreground')}>{a.status}</span>
          {a.notes ? <span className="text-muted-foreground"> · {a.notes}</span> : null}
        </li>
      ))}
    </ul>
  )
}

function CompletionPanel({ workflowId, state }: { workflowId: string; state: OffboardingState }) {
  const { run, pending, error } = useOffboardingAction(workflowId)
  const completion = state.completion
  if (!completion) return null
  if (completion.completed) return <Note tone="good" title="Exit completed — login deactivated" />
  return (
    <div className="space-y-2">
      {completion.blockers.length > 0 ? (
        <Note tone="warn" title="Blocked until these steps are completed">
          {completion.blockers.join(', ')}
        </Note>
      ) : null}
      <button type="button" disabled={completion.blockers.length > 0 || pending !== null} onClick={() => run('complete-exit')} className={cn(btn, 'bg-destructive text-white')}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Mark exit complete
      </button>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

/** The per-step panel HR sees inside each offboarding timeline card. */
export function OffboardingHrStepPanel({
  workflowId,
  stepKey,
  state,
  approvalStatus,
  locked,
}: {
  workflowId: string
  stepKey: string
  state: OffboardingState
  approvalStatus: string | null
  locked: boolean
}) {
  const waiting = approvalStatus === 'allocated'
  const renotify = waiting && stepKey !== 'hr_exit_approval' ? <RenotifyButton workflowId={workflowId} stepKey={stepKey} /> : null
  switch (stepKey) {
    case 'exit_initiated':
      return <ExitDetailsPanel workflowId={workflowId} state={state} editable={state.hrDecision?.decision !== 'approved'} />
    case 'manager_exit_approval':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Reporting manager: <span className="font-semibold text-foreground">{state.manager?.name ?? 'Not set — HR picks one on Notify'}</span></p>
          <DecisionNote label="Exit" decision={state.managerDecision} />
          {renotify}
        </div>
      )
    case 'hr_exit_approval':
      return (
        <div className="space-y-2">
          <DecisionNote label="HR decision:" decision={state.hrDecision} />
          {!locked ? <ExitDetailsPanel workflowId={workflowId} state={state} editable={state.hrDecision?.decision !== 'approved'} editLabel="Edit exit details" /> : null}
          <HrExitApprovalPanel workflowId={workflowId} approvalStatus={approvalStatus} locked={locked} state={state} />
        </div>
      )
    case 'knowledge_transfer':
      return (
        <div className="space-y-2">
          <HandoverReadOnly state={state} />
          {renotify}
        </div>
      )
    case 'it_access_deactivation':
      return (
        <div className="space-y-2">
          <ReviewSummaryPanel workflowId={workflowId} stepKey={stepKey} badgeLabel="IT access" />
          <AccessActionsList state={state} />
          {renotify}
        </div>
      )
    case 'asset_recovery':
      return approvalStatus ? (
        <div className="space-y-2">
          <AssetsReadOnly state={state} />
          {renotify}
        </div>
      ) : null
    case 'finance_settlement':
      return (
        <div className="space-y-2">
          <ReviewSummaryPanel workflowId={workflowId} stepKey={stepKey} badgeLabel="Settlement" />
          {renotify}
        </div>
      )
    case 'legal_clearance':
      return (
        <div className="space-y-2">
          <ReviewSummaryPanel workflowId={workflowId} stepKey={stepKey} badgeLabel="Legal clearance" />
          {renotify}
        </div>
      )
    case 'exit_completed':
      return <CompletionPanel workflowId={workflowId} state={state} />
    default:
      return null
  }
}

// ---------- Manager picker (Notify on manager_exit_approval with no manager set) ----------

export function ManagerPickerDialog({
  candidates,
  onCancel,
  onPick,
}: {
  candidates: { id: string; name: string }[]
  onCancel: () => void
  onPick: (managerUserId: string) => Promise<void>
}) {
  const [choice, setChoice] = useState(candidates[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <UserCheck className="h-5 w-5 text-blue-ink" /> Choose the reporting manager
        </h2>
        <p className="text-sm text-muted-foreground">No reporting manager is set for this employee. The one you choose is saved to their record and notified.</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-destructive">No users with the Manager role exist.</p>
        ) : (
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inputCls}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground">
            Cancel
          </button>
          <button
            type="button"
            disabled={!choice || pending}
            onClick={async () => {
              setPending(true)
              setError(null)
              try {
                await onPick(choice)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to notify')
              } finally {
                setPending(false)
              }
            }}
            className="flex-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? 'Notifying…' : 'Save & notify'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Exiting employee's own card ----------

export function OffboardingEmployeeCard({ workflowId }: { workflowId: string }) {
  const { data } = useOffboardingState(workflowId)
  const { run, pending, error } = useOffboardingAction(workflowId)
  const [notes, setNotes] = useState<string | null>(null)
  const [sentDetails, setSentDetails] = useState(false)
  if (!data || data.viewer !== 'employee') return null
  const h = data.handover
  const assets = data.assets ?? []
  const settlement = data.settlement
  const exitRequest = (data.exitDetailsRequest as EmployeeExitRequest | null | undefined) ?? null

  if (!h && assets.length === 0 && !settlement?.processed && !exitRequest && !sentDetails) return null
  return (
    <div className="space-y-4 rounded-3xl border border-yellow-ink/20 bg-yellow-soft p-5 shadow-soft">
      <p className="text-sm font-semibold text-foreground">Your offboarding actions</p>
      {exitRequest ? (
        <EmployeeExitDetailsForm
          key={exitRequest.id}
          request={exitRequest}
          pending={pending}
          error={error}
          run={async (action, body) => {
            const ok = await run(action, body)
            if (ok) setSentDetails(true)
            return ok
          }}
        />
      ) : sentDetails ? (
        <div className="rounded-2xl bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[#1f8a52]">
            <Check className="h-4 w-4" /> Thanks — your details were sent to HR.
          </p>
        </div>
      ) : null}
      {h ? (
        <div className="space-y-2 rounded-2xl bg-card p-4">
          <p className="text-sm font-semibold text-foreground">Confirm your handover notes</p>
          {h.items.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {h.items.map((i) => (
                <li key={i.label}>
                  {i.label} → {i.newOwner}
                </li>
              ))}
            </ul>
          ) : null}
          {h.confirmedAt ? (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f8a52]">
              <Check className="h-3.5 w-3.5" /> Confirmed {formatDateTime(h.confirmedAt)} — waiting on your manager
            </p>
          ) : (
            <>
              <textarea value={notes ?? h.employeeNotes ?? h.draftNotes} onChange={(e) => setNotes(e.target.value)} rows={6} className={inputCls} />
              <button type="button" disabled={pending !== null} onClick={() => run('handover-confirm', { notes: notes ?? h.employeeNotes ?? h.draftNotes })} className={cn(btn, 'bg-primary text-primary-foreground')}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm handover notes
              </button>
            </>
          )}
        </div>
      ) : null}
      {assets.length > 0 ? (
        <div className="space-y-2 rounded-2xl bg-card p-4">
          <p className="text-sm font-semibold text-foreground">Return these assets by {data.exitDetails.lastWorkingDay ?? 'your last day'}</p>
          <ul className="space-y-1 text-xs">
            {assets.map((a) => (
              <li key={a.name + a.serial} className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                {a.name}
                {a.serial ? ` (${a.serial})` : ''} — <span className="font-semibold">{a.status === 'pending' ? 'to return' : a.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {settlement?.processed ? (
        <div className="rounded-2xl bg-card p-4 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-[#1f8a52]">
            <Check className="h-4 w-4" /> Your final settlement has been processed by Finance
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{settlement.processedAt ? formatDateTime(settlement.processedAt) : ''} · Finance will contact you with the details.</p>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}


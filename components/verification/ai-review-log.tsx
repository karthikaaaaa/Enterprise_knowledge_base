'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Undo2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  AiLogHrSummary,
  AiLogOverallStatus,
  AiLogTask,
  AiLogTaskStatus,
  AiVerificationLog,
} from '@/lib/ai-verification-log'

/**
 * Display for the structured AI review log (lib/ai-verification-log.ts). Step-agnostic: Finance
 * Verification uses it today; another step can reuse it by serving the same JSON shape.
 *   - AiReviewLog: the full itemized log (department reviewer, or HR read-only via View Details)
 *   - AiReviewDecision: Verify / Send back controls, gated on the overall status
 *   - AiReviewShortSummary: HR's timeline card — short summary only
 */

export type AiReviewInfo = {
  action: 'verified' | 'sent_back'
  comment: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export type AiRunHistoryItem = {
  runId: string
  generatedAt: string
  overallStatus: AiLogOverallStatus
  model: string
  generatedBy: string
  review: AiReviewInfo | null
  /** Run from an earlier round of this step that was later reverted — kept as history. */
  beforeRevert?: boolean
}

const OVERALL: Record<AiLogOverallStatus, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-[#e3f4ea] text-[#1f8a52]' },
  needs_attention: { label: 'Needs attention', className: 'bg-yellow-soft text-yellow-ink' },
  blocked: { label: 'Blocked', className: 'bg-destructive/10 text-destructive' },
}

const TASK_ICON: Record<AiLogTaskStatus, { icon: typeof Check; className: string; label: string }> = {
  done: { icon: Check, className: 'text-[#1f8a52]', label: 'Done' },
  warning: { icon: AlertTriangle, className: 'text-yellow-ink', label: 'Warning' },
  failed: { icon: XCircle, className: 'text-destructive', label: 'Failed' },
  not_applicable: { icon: CircleSlash, className: 'text-muted-foreground', label: 'Not applicable' },
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function OverallStatusBadge({ status }: { status: AiLogOverallStatus }) {
  const config = OVERALL[status] ?? OVERALL.needs_attention
  return <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', config.className)}>{config.label}</span>
}

/** Evidence links point at authed API routes, which a plain <a href> can't call (no x-user-email
 * header) — fetch with the header and open the result as a blob instead. The window is opened
 * synchronously so the click isn't treated as a popup. */
export function openAuthedLink(link: string, email: string | null | undefined) {
  const win = window.open('', '_blank')
  fetch(link, { headers: email ? { 'x-user-email': email } : {} })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Request failed (${response.status})`)
      const url = URL.createObjectURL(await response.blob())
      if (win) win.location.href = url
      else window.open(url, '_blank')
    })
    .catch(() => win?.close())
}

function MissingDataCallout({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-yellow-ink/20 bg-yellow-soft px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">
        <AlertTriangle className="h-3.5 w-3.5" />
        Missing data
      </p>
      <ul className="mt-1 list-disc pl-5 text-sm text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function TaskSection({ task, onOpenLink }: { task: AiLogTask; onOpenLink?: (link: string) => void }) {
  const [open, setOpen] = useState(task.status === 'failed')
  const status = TASK_ICON[task.status] ?? TASK_ICON.warning
  const Icon = status.icon
  return (
    <div className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Icon className={cn('h-4 w-4 shrink-0', status.className)} aria-label={status.label} />
        <span className="flex-1 text-sm font-semibold text-foreground">{task.title}</span>
        <span className={cn('text-[11px] font-semibold', status.className)}>{status.label}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What the AI did</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-foreground">
              {task.actionsTaken.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ol>
          </div>

          {task.evidence.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Label</th>
                      <th className="py-1 pr-3 font-semibold">Value</th>
                      <th className="py-1 pr-3 font-semibold">Source</th>
                      <th className="py-1 font-semibold">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.evidence.map((ev, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="py-1.5 pr-3 font-medium text-foreground">{ev.label}</td>
                        <td className="py-1.5 pr-3 text-foreground">{ev.value}</td>
                        <td className="break-all py-1.5 pr-3 font-mono text-[11px] text-muted-foreground">{ev.source}</td>
                        <td className="py-1.5">
                          {ev.link && onOpenLink ? (
                            <button
                              type="button"
                              onClick={() => onOpenLink(ev.link!)}
                              className="inline-flex items-center gap-1 font-semibold text-blue-ink hover:underline"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {task.issues.length > 0 ? (
            <div className="rounded-xl bg-yellow-soft px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">Issues</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                {task.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {task.recommendation ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recommendation</p>
              <p className="mt-1 text-sm text-foreground">{task.recommendation}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ReviewNote({ review }: { review: AiReviewInfo }) {
  const sentBack = review.action === 'sent_back'
  return (
    <div className={cn('rounded-2xl px-4 py-3', sentBack ? 'bg-destructive/10' : 'bg-secondary')}>
      <p className={cn('text-[11px] font-semibold uppercase tracking-wide', sentBack ? 'text-destructive' : 'text-muted-foreground')}>
        {sentBack ? 'Sent back' : 'Verified'} by {review.reviewedBy ?? 'unknown'} · {formatDateTime(review.reviewedAt)}
      </p>
      {review.comment ? <p className="mt-1 text-sm text-foreground">{review.comment}</p> : null}
    </div>
  )
}

function RunHistory({ history }: { history: AiRunHistoryItem[] }) {
  const [open, setOpen] = useState(false)
  if (history.length <= 1) return null
  return (
    <div className="rounded-2xl bg-secondary/60 px-4 py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-xs font-semibold text-foreground">Run history ({history.length} runs)</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className="mt-2 space-y-2">
          {history.map((run, i) => (
            <li key={run.runId} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <OverallStatusBadge status={run.overallStatus} />
              <span className="text-foreground">{formatDateTime(run.generatedAt)}</span>
              <span>· {run.generatedBy}</span>
              <span>· {run.model}</span>
              {i === 0 ? <span className="font-semibold text-blue-ink">· current</span> : null}
              {run.beforeRevert ? <span>· before a revert</span> : null}
              {run.review ? (
                <span className={run.review.action === 'sent_back' ? 'text-destructive' : 'text-[#1f8a52]'}>
                  · {run.review.action === 'sent_back' ? 'sent back' : 'verified'} by {run.review.reviewedBy}
                  {run.review.comment ? ` — “${run.review.comment}”` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function AiReviewLog({
  log,
  history = [],
  review = null,
  readOnly = false,
  onRerun,
  rerunning = false,
  onOpenLink,
}: {
  log: AiVerificationLog
  history?: AiRunHistoryItem[]
  review?: AiReviewInfo | null
  /** HR's View Details: no Re-run, same log. */
  readOnly?: boolean
  onRerun?: () => void
  rerunning?: boolean
  onOpenLink?: (link: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <OverallStatusBadge status={log.overallStatus} />
        <span className="text-xs text-muted-foreground">
          Generated {formatDateTime(log.generatedAt)} · {log.model}
        </span>
        {!readOnly && onRerun ? (
          <button
            type="button"
            onClick={onRerun}
            disabled={rerunning}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-60"
          >
            {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-run AI
          </button>
        ) : null}
      </div>

      <MissingDataCallout items={log.missingData} />

      <p className="text-sm leading-relaxed text-muted-foreground">{log.shortSummary}</p>

      <div className="space-y-2">
        {log.tasks.map((task) => (
          <TaskSection key={task.id} task={task} onOpenLink={onOpenLink} />
        ))}
      </div>

      {review ? <ReviewNote review={review} /> : null}
      <RunHistory history={history} />
    </div>
  )
}

/** Verify / Send back. A 'ready' run verifies with one click; anything flagged needs the
 * acknowledgement checkbox and a comment first (the server enforces the same rule). */
export function AiReviewDecision({
  overallStatus,
  pending,
  onVerify,
  onSendBack,
  verifyLabel = 'Verify',
}: {
  overallStatus: AiLogOverallStatus
  pending: 'verify' | 'send_back' | null
  onVerify: (input: { acknowledged: boolean; comment: string }) => void
  onSendBack?: (comment: string) => void
  verifyLabel?: string
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [comment, setComment] = useState('')
  const [mode, setMode] = useState<'verify' | 'send_back'>('verify')
  const flagged = overallStatus !== 'ready'
  const hasComment = comment.trim().length > 0
  const canVerify = !flagged || (acknowledged && hasComment)

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      {mode === 'verify' && flagged ? (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
          />
          I&apos;ve reviewed the flagged issues
        </label>
      ) : null}
      {mode === 'send_back' || flagged ? (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder={mode === 'send_back' ? 'What needs to be fixed? (required)' : 'Why is it OK to verify despite the flagged issues? (required)'}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'verify' ? (
          <>
            <button
              type="button"
              onClick={() => onVerify({ acknowledged, comment: comment.trim() })}
              disabled={!canVerify || pending !== null}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f8a52] px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-50"
            >
              {pending === 'verify' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {verifyLabel}
            </button>
            {onSendBack ? (
              <button
                type="button"
                onClick={() => setMode('send_back')}
                disabled={pending !== null}
                className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Send back
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSendBack?.(comment.trim())}
              disabled={!hasComment || pending !== null}
              className="inline-flex items-center gap-1.5 rounded-xl bg-destructive px-3 py-2 text-xs font-semibold text-white shadow-soft disabled:pointer-events-none disabled:opacity-50"
            >
              {pending === 'send_back' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Send back to HR
            </button>
            <button
              type="button"
              onClick={() => setMode('verify')}
              disabled={pending !== null}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** HR's timeline card: short summary, status, missing items, and the reviewer's sign-off. */
export function AiReviewShortSummary({
  summary,
  review,
  badgeLabel,
}: {
  summary: AiLogHrSummary
  review: AiReviewInfo | null
  badgeLabel: string
}) {
  return (
    <div className="space-y-2 rounded-2xl bg-secondary/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">{badgeLabel}</span>
        <OverallStatusBadge status={summary.overallStatus} />
      </div>
      <p className="text-sm leading-relaxed text-foreground">{summary.shortSummary}</p>
      {summary.missingData.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-yellow-ink">Missing:</span> {summary.missingData.join(', ')}
        </p>
      ) : null}
      {review ? <ReviewNote review={review} /> : null}
    </div>
  )
}

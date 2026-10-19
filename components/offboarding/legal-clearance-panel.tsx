'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, FileSignature, Loader2, Scale } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'

/** Legal Clearance: lets Legal confirm the tasks the records can't settle — the confidentiality
 * acknowledgement and the restrictive-covenant review (lib/offboarding/legal-clearance.ts). */

type Task = 'confidentiality_obligations' | 'restrictive_covenants'

type Confirmation = {
  task: Task
  clausesApply: boolean | null
  clauses: string | null
  note: string | null
  confirmedByName: string
  confirmedAt: string
}

type LegalClearanceResponse = {
  needs: Record<Task, boolean>
  confirmations: Record<Task, Confirmation | null>
  canConfirm: boolean
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'

export function LegalClearancePanel({ workflowId, readOnly = false, onSaved }: { workflowId: string; readOnly?: boolean; onSaved?: () => void }) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/legal_clearance/confirmations`
  const { data, error, isLoading, mutate } = useSWR<LegalClearanceResponse>(user ? url : null, authedFetcher(user?.email))

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading legal confirmations…</p>
  if (error || !data) return <p className="text-xs font-medium text-destructive">{error?.message ?? 'Could not load the legal confirmations'}</p>
  if (!data.needs.confidentiality_obligations && !data.needs.restrictive_covenants) return null

  const saved = async () => {
    await mutate()
    onSaved?.()
  }
  const canConfirm = data.canConfirm && !readOnly

  return (
    <div className="space-y-3">
      {data.needs.confidentiality_obligations ? (
        <ConfirmCard
          url={url}
          task="confidentiality_obligations"
          title="Confidentiality / IP obligations"
          icon={<FileSignature className="h-4 w-4 text-blue-ink" />}
          missing="No signed confidentiality agreement is on file. Remind the employee of their confidentiality and IP obligations, then confirm they acknowledged them."
          confirmation={data.confirmations.confidentiality_obligations}
          canConfirm={canConfirm}
          onSaved={saved}
        />
      ) : null}
      {data.needs.restrictive_covenants ? (
        <ConfirmCard
          url={url}
          task="restrictive_covenants"
          title="Non-compete / notice clauses"
          icon={<Scale className="h-4 w-4 text-blue-ink" />}
          missing="No offer letter with non-compete or notice clauses is on file. Review the employment contract and record what applies."
          confirmation={data.confirmations.restrictive_covenants}
          canConfirm={canConfirm}
          onSaved={saved}
        />
      ) : null}
    </div>
  )
}

function ConfirmCard({
  url,
  task,
  title,
  icon,
  missing,
  confirmation,
  canConfirm,
  onSaved,
}: {
  url: string
  task: Task
  title: string
  icon: React.ReactNode
  missing: string
  confirmation: Confirmation | null
  canConfirm: boolean
  onSaved: () => Promise<void>
}) {
  const { user } = useAuth()
  const isCovenants = task === 'restrictive_covenants'
  const [editing, setEditing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [clausesApply, setClausesApply] = useState(false)
  const [clauses, setClauses] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const showForm = canConfirm && (!confirmation || editing)
  const valid = isCovenants ? !clausesApply || clauses.trim() !== '' : acknowledged

  async function save() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email, { task, clausesApply, clauses, note })
      setEditing(false)
      await onSaved()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setPending(false)
    }
  }

  function startEdit() {
    if (confirmation) {
      setAcknowledged(true)
      setClausesApply(!!confirmation.clausesApply)
      setClauses(confirmation.clauses ?? '')
      setNote(confirmation.note ?? '')
    }
    setEditing(true)
  }

  const summary = !confirmation
    ? null
    : isCovenants
      ? confirmation.clausesApply
        ? `Clauses apply: ${confirmation.clauses}`
        : 'No non-compete or notice clauses apply'
      : 'Employee acknowledged their confidentiality / IP obligations'

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </p>

      {confirmation ? (
        <div className="space-y-1 rounded-xl bg-[#e3f4ea] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
            <Check className="h-3.5 w-3.5" />
            Confirmed by Legal
          </p>
          <p className="text-sm font-semibold text-foreground">{summary}</p>
          <p className="text-xs text-muted-foreground">
            {confirmation.confirmedByName} · {confirmation.confirmedAt.slice(0, 16).replace('T', ' ')} UTC
            {confirmation.note ? ` — ${confirmation.note}` : ''}
          </p>
          {canConfirm && !editing ? (
            <button type="button" onClick={startEdit} className="text-xs font-semibold text-blue-ink hover:underline">
              Change
            </button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl bg-yellow-soft px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">
            <AlertTriangle className="h-3.5 w-3.5" />
            Not confirmed
          </p>
          <p className="mt-1 text-sm text-foreground">{missing}</p>
        </div>
      )}

      {showForm ? (
        <div className="space-y-3">
          {isCovenants ? (
            <>
              <div className="flex flex-wrap gap-4 text-xs font-semibold text-foreground">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name={`covenants-${url}`} checked={!clausesApply} onChange={() => setClausesApply(false)} />
                  No clauses apply
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name={`covenants-${url}`} checked={clausesApply} onChange={() => setClausesApply(true)} />
                  Clauses apply
                </label>
              </div>
              {clausesApply ? (
                <label className="block space-y-1 text-xs font-semibold text-foreground">
                  Clauses that apply
                  <input
                    type="text"
                    maxLength={500}
                    value={clauses}
                    onChange={(e) => setClauses(e.target.value)}
                    placeholder="e.g. 30-day notice period; 6-month non-solicit"
                    className={inputClass}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <label className="flex items-start gap-2 text-xs font-semibold text-foreground">
              <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              The employee was reminded of, and acknowledged, their confidentiality and IP obligations after leaving.
            </label>
          )}
          <label className="block space-y-1 text-xs font-semibold text-foreground">
            Note (optional)
            <input
              type="text"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isCovenants ? 'e.g. Reviewed the signed employment contract' : 'e.g. Acknowledged in the exit interview'}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !valid}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Confirm
            </button>
            {editing ? (
              <button type="button" onClick={() => setEditing(false)} className="text-xs font-semibold text-muted-foreground hover:underline">
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
    </div>
  )
}

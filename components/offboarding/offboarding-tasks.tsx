'use client'

import { useState } from 'react'
import { Check, Loader2, PackageCheck, PackageX, ShieldCheck, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOffboardingAction, useOffboardingState } from '@/components/offboarding/offboarding-panels'

/** Offboarding task panels on the department Tasks page (manager exit approval, knowledge-transfer
 * acceptance, asset recovery). The AI-automated steps reuse the shared structured review panel. */

const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-soft transition-all duration-200 disabled:pointer-events-none disabled:opacity-50'
const inputCls = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'

function Done({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f8a52]">
      <Check className="h-3.5 w-3.5" /> {label}
    </p>
  )
}

export function ManagerExitTask({ workflowId, status, onUpdated }: { workflowId: string; status: string; onUpdated: (patch: { status: string }) => void }) {
  const { data, error: loadError } = useOffboardingState(workflowId)
  const { run, pending, error } = useOffboardingAction(workflowId)
  const [comment, setComment] = useState('')
  const [mode, setMode] = useState<'approve' | 'send_back'>('approve')
  if (loadError) return <p className="text-xs font-medium text-destructive">{loadError.message}</p>
  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>
  const d = data.exitDetails
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm">
        <p>
          <span className="font-semibold">{data.employee?.name}</span> — {d.exitType === 'not_recorded' ? 'exit type not recorded' : d.exitType}
        </p>
        <p>
          Last working day: {d.lastWorkingDay ?? 'not set'}
          {d.noticePeriodDays != null ? ` · ${d.noticePeriodDays}-day notice` : ''}
        </p>
        {d.reason ? <p>Reason: {d.reason}</p> : null}
      </div>
      {data.managerDecision?.decision === 'sent_back' ? (
        <p className="text-xs text-destructive">You sent this back: “{data.managerDecision.comment}” — HR will follow up. You can still approve.</p>
      ) : null}
      {status === 'completed' ? (
        <Done label="Approved — awaiting HR verification" />
      ) : (
        <div className="space-y-2 rounded-2xl border border-border p-4">
          {mode === 'send_back' ? (
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Why are you sending this back? (required)" className={inputCls} />
          ) : (
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Optional comment for HR" className={inputCls} />
          )}
          <div className="flex flex-wrap gap-2">
            {mode === 'approve' ? (
              <>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={async () => (await run('manager-decision', { decision: 'approved', comment })) && onUpdated({ status: 'completed' })}
                  className={cn(btn, 'bg-[#1f8a52] text-white')}
                >
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Approve exit
                </button>
                <button type="button" onClick={() => setMode('send_back')} className={cn(btn, 'bg-secondary text-foreground')}>
                  <Undo2 className="h-3.5 w-3.5" /> Send back
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending !== null || !comment.trim()}
                  onClick={async () => (await run('manager-decision', { decision: 'sent_back', comment })) && setMode('approve')}
                  className={cn(btn, 'bg-destructive text-white')}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Send back to HR
                </button>
                <button type="button" onClick={() => setMode('approve')} className="px-3 text-xs font-semibold text-muted-foreground">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

export function ManagerHandoverTask({ workflowId, status, onUpdated }: { workflowId: string; status: string; onUpdated: (patch: { status: string }) => void }) {
  const { data, error: loadError } = useOffboardingState(workflowId)
  const { run, pending, error } = useOffboardingAction(workflowId)
  if (loadError) return <p className="text-xs font-medium text-destructive">{loadError.message}</p>
  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>
  const h = data.handover
  if (!h) return <p className="text-xs text-muted-foreground">No handover plan yet.</p>
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Items to hand over (AI-proposed owner)</p>
        {h.items.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No owned documents or open tasks on record.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {h.items.map((i) => (
              <li key={i.label}>
                {i.label}: {i.currentOwner} → <span className="font-semibold">{i.newOwner}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl bg-secondary/60 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {h.employeeConfirmedAt ? "Employee's confirmed handover notes" : 'AI draft — waiting on the employee to confirm'}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{h.employeeNotes ?? h.draftNotes}</p>
      </div>
      {status === 'completed' ? (
        <Done label="Accepted — ownership transferred, awaiting HR verification" />
      ) : (
        <button
          type="button"
          disabled={!h.employeeConfirmedAt || pending !== null}
          onClick={async () => (await run('handover-accept')) && onUpdated({ status: 'completed' })}
          className={cn(btn, 'bg-[#1f8a52] text-white')}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept handover & transfer ownership
        </button>
      )}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

export function AssetRecoveryTask({ workflowId, status, onUpdated }: { workflowId: string; status: string; onUpdated: (patch: { status: string }) => void }) {
  const { data, error: loadError } = useOffboardingState(workflowId)
  const { run, pending, error } = useOffboardingAction(workflowId)
  const [notes, setNotes] = useState<Record<string, string>>({})
  if (loadError) return <p className="text-xs font-medium text-destructive">{loadError.message}</p>
  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>
  const assets = data.assets ?? []
  const done = status === 'completed'
  return (
    <div className="space-y-3">
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assets are assigned to this employee in records — nothing to recover.</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <li key={a.id} className="space-y-2 rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{a.name}</span>
                {a.serial ? <span className="text-muted-foreground">({a.serial})</span> : null}
                <span className={cn('ml-auto text-xs font-semibold', a.status === 'missing' ? 'text-destructive' : a.status === 'returned' ? 'text-[#1f8a52]' : 'text-muted-foreground')}>
                  {a.status}
                </span>
              </div>
              {a.notes ? <p className="text-xs text-muted-foreground">Notes: {a.notes}</p> : null}
              {!done ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={notes[a.id!] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [a.id!]: e.target.value }))}
                    placeholder="Condition notes (optional)"
                    className={cn(inputCls, 'max-w-xs py-1.5 text-xs')}
                  />
                  <button type="button" disabled={pending !== null} onClick={() => run('asset-mark', { item_id: a.id, status: 'returned', notes: notes[a.id!] })} className={cn(btn, 'bg-[#e3f4ea] text-[#1f8a52]')}>
                    <PackageCheck className="h-3.5 w-3.5" /> Returned
                  </button>
                  <button type="button" disabled={pending !== null} onClick={() => run('asset-mark', { item_id: a.id, status: 'missing', notes: notes[a.id!] })} className={cn(btn, 'bg-destructive/10 text-destructive')}>
                    <PackageX className="h-3.5 w-3.5" /> Missing
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {done ? (
        <Done label="Asset recovery complete — awaiting HR verification" />
      ) : (
        <button
          type="button"
          disabled={pending !== null || assets.some((a) => a.status === 'pending')}
          onClick={async () => (await run('asset-complete')) && onUpdated({ status: 'completed' })}
          className={cn(btn, 'bg-[#1f8a52] text-white')}
        >
          {pending === 'asset-complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify asset recovery
        </button>
      )}
      {assets.some((a) => a.status === 'missing') ? <p className="text-xs text-muted-foreground">Missing items are passed to Finance Settlement as possible deductions.</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

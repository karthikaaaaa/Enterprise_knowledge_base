'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, Loader2, Receipt, Wallet } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'

/** Finance Settlement: shows the final pay, and lets Finance enter it when payroll can't calculate
 * it; and lets Finance confirm the pending reimbursements (lib/offboarding/final-pay.ts). */

type ReimbursementConfirmation = {
  outstanding: boolean
  amount: number | null
  currency: string | null
  note: string | null
  confirmedByName: string
  confirmedAt: string
}

type FinalPayResponse = {
  finalPay: { amount: number | null; currency: string | null; basis: string; source: 'payroll' | 'finance' | 'placeholder' }
  entry: { amount: number; currency: string; note: string | null; enteredByName: string; enteredAt: string } | null
  canEnter: boolean
  reimbursements: ReimbursementConfirmation | null
  canConfirmReimbursements: boolean
}

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'

export function FinalPayPanel({ workflowId, readOnly = false, onSaved }: { workflowId: string; readOnly?: boolean; onSaved?: () => void }) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/finance_settlement/final-pay`
  const { data, error, isLoading, mutate } = useSWR<FinalPayResponse>(user ? url : null, authedFetcher(user?.email))
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading final pay…</p>
  if (error || !data) return <p className="text-xs font-medium text-destructive">{error?.message ?? 'Could not load the final pay'}</p>

  const { finalPay, entry, canEnter } = data
  const showForm = canEnter && !readOnly && (finalPay.source === 'placeholder' || editing)

  async function save() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email, { amount, currency, note })
      setEditing(false)
      await mutate()
      onSaved?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save the final pay')
    } finally {
      setPending(false)
    }
  }

  function startEdit() {
    if (entry) {
      setAmount(String(entry.amount))
      setCurrency(entry.currency)
      setNote(entry.note ?? '')
    }
    setEditing(true)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-2xl border border-border p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="h-4 w-4 text-blue-ink" />
          Final pay
        </p>

        {finalPay.amount !== null && finalPay.currency ? (
          <div className="space-y-1 rounded-xl bg-[#e3f4ea] px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
              <Check className="h-3.5 w-3.5" />
              {finalPay.source === 'payroll' ? 'Calculated from payroll' : 'Entered by Finance'}
            </p>
            <p className="text-sm font-semibold text-foreground">{money(finalPay.amount, finalPay.currency)}</p>
            <p className="text-xs text-muted-foreground">{finalPay.basis}</p>
            {finalPay.source === 'finance' && canEnter && !readOnly && !editing ? (
              <button type="button" onClick={startEdit} className="text-xs font-semibold text-blue-ink hover:underline">
                Correct the amount
              </button>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl bg-yellow-soft px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">
              <AlertTriangle className="h-3.5 w-3.5" />
              Not available
            </p>
            <p className="mt-1 text-sm text-foreground">{finalPay.basis}</p>
          </div>
        )}

        {showForm ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The final pay can&apos;t be calculated from payroll, so enter it here. It goes on the settlement statement and the review re-runs.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <label className="block space-y-1 text-xs font-semibold text-foreground">
                Final pay amount
                <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 4250.00" className={inputClass} />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-foreground">
                Currency
                <input type="text" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" className={inputClass} />
              </label>
            </div>
            <label className="block space-y-1 text-xs font-semibold text-foreground">
              Note (optional)
              <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pro-rated from the signed offer letter" className={inputClass} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={pending || amount.trim() === '' || currency.trim().length !== 3}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                Save final pay
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
      <ReimbursementsCard
        workflowId={workflowId}
        confirmation={data.reimbursements}
        canConfirm={data.canConfirmReimbursements && !readOnly}
        onSaved={async () => {
          await mutate()
          onSaved?.()
        }}
      />
    </div>
  )
}

function ReimbursementsCard({
  workflowId,
  confirmation,
  canConfirm,
  onSaved,
}: {
  workflowId: string
  confirmation: ReimbursementConfirmation | null
  canConfirm: boolean
  onSaved: () => Promise<void>
}) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/finance_settlement/reimbursements`
  const [editing, setEditing] = useState(false)
  const [outstanding, setOutstanding] = useState(false)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const showForm = canConfirm && (!confirmation || editing)
  const valid = !outstanding || (amount.trim() !== '' && currency.trim().length === 3)

  async function save() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email, { outstanding, amount, currency, note })
      setEditing(false)
      await onSaved()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save the reimbursements')
    } finally {
      setPending(false)
    }
  }

  function startEdit() {
    if (confirmation) {
      setOutstanding(confirmation.outstanding)
      setAmount(confirmation.amount !== null ? String(confirmation.amount) : '')
      setCurrency(confirmation.currency ?? 'USD')
      setNote(confirmation.note ?? '')
    }
    setEditing(true)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Receipt className="h-4 w-4 text-blue-ink" />
        Pending reimbursements
      </p>

      {confirmation ? (
        <div className="space-y-1 rounded-xl bg-[#e3f4ea] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
            <Check className="h-3.5 w-3.5" />
            Confirmed by Finance
          </p>
          <p className="text-sm font-semibold text-foreground">
            {confirmation.outstanding && confirmation.amount !== null && confirmation.currency
              ? `${money(confirmation.amount, confirmation.currency)} outstanding — paid with the final settlement`
              : 'None outstanding'}
          </p>
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
          <p className="mt-1 text-sm text-foreground">No reimbursement-claims system is connected, so Finance confirms whether anything is outstanding.</p>
        </div>
      )}

      {showForm ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-xs font-semibold text-foreground">
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name={`reimb-${workflowId}`} checked={!outstanding} onChange={() => setOutstanding(false)} />
              Nothing outstanding
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name={`reimb-${workflowId}`} checked={outstanding} onChange={() => setOutstanding(true)} />
              Reimbursements outstanding
            </label>
          </div>
          {outstanding ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <label className="block space-y-1 text-xs font-semibold text-foreground">
                Outstanding amount
                <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 180.00" className={inputClass} />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-foreground">
                Currency
                <input type="text" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" className={inputClass} />
              </label>
            </div>
          ) : null}
          <label className="block space-y-1 text-xs font-semibold text-foreground">
            Note (optional)
            <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed with the employee by email" className={inputClass} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !valid}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
              Confirm reimbursements
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

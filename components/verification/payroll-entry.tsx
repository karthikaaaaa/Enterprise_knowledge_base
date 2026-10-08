'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, Loader2, Wallet } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'

/** Finance's "create payroll entry" panel — see lib/payroll.ts. Everything except compensation is
 * drafted from verified records; Finance adds compensation and confirms. */

type PayrollResponse = {
  draft: {
    ready: boolean
    blockers: string[]
    fields: { legalName: string; roleTitle: string; department: string; startDate: string; sourceSubmissionId: string } | null
    bank: { ref: string; masked: string } | null
    tax: { ref: string; masked: string } | null
  }
  record: { id: string; payFrequency: string; annualSalary: number; currency: string; createdAt: string } | null
}

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semi_monthly', label: 'Semi-monthly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'weekly', label: 'Weekly' },
]

function Row({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5 pr-3 font-medium text-foreground">{label}</td>
      <td className="py-1.5 pr-3 text-foreground">{value}</td>
      <td className="break-all py-1.5 font-mono text-[11px] text-muted-foreground">{source ?? ''}</td>
    </tr>
  )
}

export function PayrollEntryPanel({
  workflowId,
  readOnly = false,
  onCreated,
}: {
  workflowId: string
  readOnly?: boolean
  /** Called after creation — the AI review re-runs in the background, so callers refresh it. */
  onCreated?: () => void
}) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/finance_verification/payroll`
  const { data, error, isLoading, mutate } = useSWR<PayrollResponse>(user ? url : null, authedFetcher(user?.email))
  const [salary, setSalary] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [frequency, setFrequency] = useState('monthly')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading payroll draft…</p>
  if (error || !data) return <p className="text-xs font-medium text-destructive">{error?.message ?? 'Could not load the payroll draft'}</p>

  const { draft, record } = data

  if (record) {
    return (
      <div className="rounded-2xl bg-[#e3f4ea] px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
          <Check className="h-3.5 w-3.5" />
          Payroll entry created
        </p>
        <p className="mt-1 text-sm text-foreground">
          {record.currency} {record.annualSalary.toLocaleString()} / year · {FREQUENCIES.find((f) => f.value === record.payFrequency)?.label} pay
          · {new Date(record.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">payroll_records/{record.id}</p>
      </div>
    )
  }

  async function create() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email, { annual_salary: Number(salary), currency, pay_frequency: frequency })
      await mutate()
      onCreated?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create the payroll entry')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Wallet className="h-4 w-4 text-blue-ink" />
        Payroll entry {draft.ready ? '— drafted from verified records' : '— not ready yet'}
      </p>

      {draft.fields ? (
        <table className="w-full text-left text-xs">
          <tbody>
            <Row label="Legal name" value={draft.fields.legalName} source={`employee_detail_submissions/${draft.fields.sourceSubmissionId}`} />
            <Row label="Role" value={draft.fields.roleTitle} />
            <Row label="Department" value={draft.fields.department} />
            <Row label="Start date" value={draft.fields.startDate} />
            <Row label="Bank account" value={draft.bank?.masked ?? 'Not on file'} source={draft.bank ? `employee_finance_details/${draft.bank.ref}` : undefined} />
            <Row label="Tax ID" value={draft.tax?.masked ?? 'Not on file'} source={draft.tax ? `employee_finance_details/${draft.tax.ref}` : undefined} />
          </tbody>
        </table>
      ) : null}

      {draft.blockers.length > 0 ? (
        <div className="rounded-xl bg-yellow-soft px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">
            <AlertTriangle className="h-3.5 w-3.5" />
            Can&apos;t create yet
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {draft.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.ready && !readOnly ? (
        <>
          <p className="text-xs text-muted-foreground">
            Compensation isn&apos;t held in any onboarding record, so add it here — everything else above comes from verified records.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-semibold text-foreground">
              Annual salary
              <input
                type="number"
                min="0"
                step="0.01"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="e.g. 85000"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-foreground">
              Currency
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-foreground">
              Pay frequency
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={pending || !(Number(salary) > 0) || currency.length !== 3}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
            Create payroll entry
          </button>
        </>
      ) : null}
      {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
    </div>
  )
}

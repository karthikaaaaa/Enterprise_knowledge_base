'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, CreditCard, FileCheck2, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'

/** Finance's expense-account and sign-off-pack panels (lib/finance-records.ts). Same shape as the
 * payroll panel: a draft built from records, its blockers, and one Create button for the owning
 * department. DraftRecordPanel is shared with Legal's panels too. */

type Row = { label: string; value: string; source?: string }

type DraftRecordResponse<Draft> = { draft: Draft & { ready: boolean; blockers: string[] }; record: { id: string; createdAt: string } | null }

export function DraftRecordPanel<Draft>({
  url,
  icon,
  title,
  createdTitle,
  createLabel,
  readyNote,
  rows,
  recordTable,
  readOnly,
  onCreated,
}: {
  url: string
  icon: ReactNode
  title: string
  createdTitle: string
  createLabel: string
  readyNote: string
  rows: (draft: Draft) => Row[]
  recordTable: string
  readOnly: boolean
  onCreated?: () => void
}) {
  const { user } = useAuth()
  const { data, error, isLoading, mutate } = useSWR<DraftRecordResponse<Draft>>(user ? url : null, authedFetcher(user?.email))
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading {title.toLowerCase()}…</p>
  if (error || !data) return <p className="text-xs font-medium text-destructive">{error?.message ?? `Could not load ${title.toLowerCase()}`}</p>

  if (data.record) {
    return (
      <div className="rounded-2xl bg-[#e3f4ea] px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
          <Check className="h-3.5 w-3.5" />
          {createdTitle}
        </p>
        <p className="mt-1 text-sm text-foreground">{new Date(data.record.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {recordTable}/{data.record.id}
        </p>
      </div>
    )
  }

  const { draft } = data
  async function create() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email)
      await mutate()
      onCreated?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setPending(false)
    }
  }

  const tableRows = rows(draft)
  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {title} {draft.ready ? '— drafted from verified records' : '— not ready yet'}
      </p>
      {tableRows.length > 0 ? (
        <table className="w-full text-left text-xs">
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.label} className="border-t border-border align-top">
                <td className="py-1.5 pr-3 font-medium text-foreground">{row.label}</td>
                <td className="py-1.5 pr-3 text-foreground">{row.value}</td>
                <td className="break-all py-1.5 font-mono text-[11px] text-muted-foreground">{row.source ?? ''}</td>
              </tr>
            ))}
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
          <p className="text-xs text-muted-foreground">{readyNote}</p>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
            {createLabel}
          </button>
        </>
      ) : null}
      {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
    </div>
  )
}

type ExpenseDraft = {
  fields: { holderName: string; contactEmail: string; costCenter: string; approverName: string | null; sourceSubmissionId: string } | null
  reimbursement: { ref: string; masked: string } | null
}

export function ExpenseAccountPanel({ workflowId, readOnly = false, onCreated }: { workflowId: string; readOnly?: boolean; onCreated?: () => void }) {
  return (
    <DraftRecordPanel<ExpenseDraft>
      url={`/api/workflows/${workflowId}/steps/finance_verification/expense-account`}
      icon={<CreditCard className="h-4 w-4 text-blue-ink" />}
      title="Expense account"
      createdTitle="Expense account created"
      createLabel="Create expense account"
      readyNote="Every field above comes from verified records — nothing to add. Confirm to create it."
      recordTable="expense_accounts"
      readOnly={readOnly}
      onCreated={onCreated}
      rows={(draft) =>
        draft.fields
          ? [
              { label: 'Account holder', value: draft.fields.holderName, source: `employee_detail_submissions/${draft.fields.sourceSubmissionId}` },
              { label: 'Contact email', value: draft.fields.contactEmail },
              { label: 'Cost centre', value: draft.fields.costCenter },
              { label: 'Approver', value: draft.fields.approverName ?? 'No manager on file — Finance approves' },
              {
                label: 'Reimbursement account',
                value: draft.reimbursement?.masked ?? 'Not on file',
                source: draft.reimbursement ? `employee_finance_details/${draft.reimbursement.ref}` : undefined,
              },
            ]
          : []
      }
    />
  )
}

type SignoffDraft = { snapshot: Record<string, string | null> }

const SNAPSHOT_LABELS: Record<string, string> = {
  payrollRecordId: 'Payroll entry',
  expenseAccountId: 'Expense account',
  bankDetailsRef: 'Bank details',
  taxDetailsRef: 'Tax details',
  documentCheckId: 'Document cross-check',
  hrProfileEntryId: 'HR directory profile',
  submissionId: 'Employee details',
}

export function SignoffPackPanel({ workflowId, readOnly = false, onCreated }: { workflowId: string; readOnly?: boolean; onCreated?: () => void }) {
  return (
    <DraftRecordPanel<SignoffDraft>
      url={`/api/workflows/${workflowId}/steps/finance_verification/signoff`}
      icon={<FileCheck2 className="h-4 w-4 text-blue-ink" />}
      title="Finance sign-off pack"
      createdTitle="Sign-off pack created"
      createLabel="Create sign-off pack"
      readyNote="Bank & tax, payroll and expense are all in place. Creating the pack records exactly what you're signing off on."
      recordTable="finance_signoff_records"
      readOnly={readOnly}
      onCreated={onCreated}
      rows={(draft) =>
        Object.entries(SNAPSHOT_LABELS).map(([key, label]) => ({
          label,
          value: draft.snapshot[key]
            ? key === 'documentCheckId'
              ? `${draft.snapshot.documentCheckStatus ?? ''}`
              : 'On file'
            : 'Missing',
          source: draft.snapshot[key] ?? undefined,
        }))
      }
    />
  )
}

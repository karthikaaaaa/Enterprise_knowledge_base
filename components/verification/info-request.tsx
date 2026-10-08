'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Inbox, Loader2, Paperclip, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'
import {
  INFO_REQUEST_ITEMS,
  INFO_REQUEST_ITEM_KEYS,
  INFO_REQUEST_MAX_FILE_BYTES,
  isInfoRequestItemKey,
  requestableItemsFromMissing,
  type InfoRequestFieldKey,
  type InfoRequestItemKey,
} from '@/lib/info-request-items'

/** "Request info from employee" UI — see lib/employee-info-requests.ts for the flow. */

export type InfoRequestSummary = {
  id: string
  status: 'open' | 'fulfilled'
  items: string[]
  itemLabels: string
  message: string | null
  requestedBy: string
  requestedAt: string
  fulfilledAt: string | null
}

function formatDateTime(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Where a request stands — shown to HR (timeline card) and Finance (task panel). */
export function InfoRequestStatus({ request }: { request: InfoRequestSummary }) {
  const open = request.status === 'open'
  return (
    <div className={cn('rounded-2xl px-4 py-3', open ? 'bg-accent' : 'bg-[#e3f4ea]')}>
      <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide', open ? 'text-blue-ink' : 'text-[#1f8a52]')}>
        {open ? <Inbox className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        {open ? 'Waiting on employee' : 'Employee responded'}
      </p>
      <p className="mt-1 text-sm text-foreground">
        {open
          ? `${request.requestedBy} asked for: ${request.itemLabels} · ${formatDateTime(request.requestedAt)}`
          : `Submitted ${request.itemLabels} · ${formatDateTime(request.fulfilledAt)}. The finance AI review is re-run with them automatically.`}
      </p>
      {open && request.message ? <p className="mt-1 text-xs text-muted-foreground">“{request.message}”</p> : null}
    </div>
  )
}

/** HR: ask the employee for what Finance flagged as missing. Pre-ticks the items the run's
 * missingData calls for; only items the employee can actually provide are offered. */
export function RequestEmployeeInfoForm({
  workflowId,
  missingData,
  onRequested,
}: {
  workflowId: string
  missingData: string[]
  onRequested: () => Promise<unknown> | void
}) {
  const { user } = useAuth()
  const suggested = requestableItemsFromMissing(missingData)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InfoRequestItemKey[]>(suggested)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
      >
        <Send className="h-3.5 w-3.5" />
        Request from employee
      </button>
    )
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await authedPost(`/api/workflows/${workflowId}/steps/finance_verification/info-requests`, user?.email, { items, message })
      setOpen(false)
      await onRequested()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the request')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="text-sm font-semibold text-foreground">Ask the employee for</p>
      {INFO_REQUEST_ITEM_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={items.includes(key)}
            onChange={(e) => setItems((prev) => (e.target.checked ? [...prev, key] : prev.filter((k) => k !== key)))}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          {INFO_REQUEST_ITEMS[key].label}
          {suggested.includes(key) ? <span className="text-[11px] text-muted-foreground">(flagged missing)</span> : null}
        </label>
      ))}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Optional note to the employee"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || items.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send request
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

type EmployeeRequestResponse = {
  request: { id: string; items: string[]; message: string | null; requestedAt: string } | null
}

/** The employee's "Finance needs your details" card on their own onboarding page. Renders nothing
 * unless there's an open request, so the page is otherwise unchanged. */
export function EmployeeInfoRequestCard({ workflowId }: { workflowId: string }) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/finance_verification/info-requests`
  const { data, mutate } = useSWR<EmployeeRequestResponse>(user ? url : null, authedFetcher(user?.email))
  const [values, setValues] = useState<Partial<Record<InfoRequestFieldKey, string>>>({})
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[#1f8a52]">
          <Check className="h-4 w-4" />
          Thanks — your details were sent to Finance.
        </p>
      </div>
    )
  }

  const request = data?.request
  if (!request) return null
  const items = request.items.filter(isInfoRequestItemKey).map((key) => INFO_REQUEST_ITEMS[key])
  const fields = items.flatMap((item) => item.fields)

  async function submit() {
    if (!request) return
    setError(null)
    for (const field of fields) {
      const value = values[field.key]?.trim() ?? ''
      if (!value) return setError(`${field.label} is required`)
      if (!field.pattern.test(value)) return setError(`${field.label}: ${field.patternHint}`)
    }
    if (file && file.size > INFO_REQUEST_MAX_FILE_BYTES) return setError('File is too large (max 8MB)')

    setPending(true)
    try {
      await authedPost(`${url}/${request.id}/submit`, user?.email, {
        fields: values,
        ...(file ? { file_name: file.name, file_mime_type: file.type, file_data: await readAsBase64(file) } : {}),
      })
      setSubmitted(true)
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-yellow-ink/20 bg-yellow-soft p-5 shadow-soft">
      <div>
        <p className="text-sm font-semibold text-foreground">
          Finance needs your {items.map((i) => i.label).join(' and ')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your onboarding can&apos;t be signed off by Finance until these are on file. Account and tax numbers are only ever
          shown to Finance and HR, masked to the last 4 characters.
        </p>
        {request.message ? <p className="mt-2 text-sm text-foreground">HR: “{request.message}”</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1 text-xs font-semibold text-foreground">
            {field.label}
            <input
              type="text"
              autoComplete="off"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" />
        Supporting document (optional — e.g. bank letter, tax certificate)
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send to Finance
        </button>
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}

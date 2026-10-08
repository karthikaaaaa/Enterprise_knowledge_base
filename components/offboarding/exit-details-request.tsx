'use client'

import { useState } from 'react'
import { Bell, Check, Inbox, Loader2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  EXIT_DETAIL_FIELDS,
  EXIT_DETAIL_FIELD_KEYS,
  validateExitDetailValues,
  type ExitDetailFieldKey,
} from '@/lib/offboarding/exit-detail-fields'

/** "Request details from employee" on HR Exit Approval, and the exiting employee's answer form —
 * the offboarding twin of components/verification/info-request.tsx. Flow: lib/offboarding/exit-info-requests.ts. */

export type ExitDetailsRequestSummary = {
  id: string
  status: 'open' | 'fulfilled'
  fields: ExitDetailFieldKey[]
  fieldLabels: string
  message: string | null
  requestedBy: string
  requestedAt: string
  fulfilledAt: string | null
}

type RunAction = (action: string, body?: Record<string, unknown>) => Promise<boolean>

const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-soft transition-all duration-200 disabled:pointer-events-none disabled:opacity-50'

function formatDateTime(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** HR side: the request button (pre-ticked with what the pre-check flagged), or the open request's
 * status with "Re-notify employee", or the employee's response. */
export function HrExitDetailsRequest({
  request,
  requestableFields,
  isTermination,
  run,
  pending,
}: {
  request: ExitDetailsRequestSummary | null
  requestableFields: ExitDetailFieldKey[]
  isTermination: boolean
  run: RunAction
  pending: string | null
}) {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState<ExitDetailFieldKey[]>(requestableFields)
  const [message, setMessage] = useState('')
  const [reminded, setReminded] = useState(false)

  if (request?.status === 'open') {
    return (
      <div className="space-y-2 rounded-2xl bg-accent px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-ink">
          <Inbox className="h-3.5 w-3.5" /> Awaiting employee details
        </p>
        <p className="text-sm text-foreground">
          {request.requestedBy} asked for: {request.fieldLabels} · {formatDateTime(request.requestedAt)}
        </p>
        {request.message ? <p className="text-xs text-muted-foreground">“{request.message}”</p> : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={async () => setReminded(await run('renotify-exit-details'))}
            className={cn(btn, 'bg-card text-foreground')}
          >
            {pending === 'renotify-exit-details' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            Re-notify employee
          </button>
          {reminded ? <span className="text-xs text-[#1f8a52]">Reminder sent</span> : null}
        </div>
      </div>
    )
  }

  const responded =
    request?.status === 'fulfilled' ? (
      <div className="rounded-2xl bg-[#e3f4ea] px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f8a52]">
          <Check className="h-3.5 w-3.5" /> Employee responded
        </p>
        <p className="mt-1 text-sm text-foreground">
          Submitted {request.fieldLabels} · {formatDateTime(request.fulfilledAt)}. The pre-check was re-run with them.
        </p>
      </div>
    ) : null

  if (requestableFields.length === 0) {
    return (
      <>
        {responded}
        {isTermination ? (
          <p className="text-xs text-muted-foreground">Termination — the employee doesn&apos;t provide exit details. Fill any gaps with Edit exit details.</p>
        ) : null}
      </>
    )
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {responded}
        <button
          type="button"
          onClick={() => {
            setFields(requestableFields)
            setOpen(true)
          }}
          className={cn(btn, 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-lift')}
        >
          <Send className="h-3.5 w-3.5" /> Request details from employee
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="text-sm font-semibold text-foreground">Ask the employee for</p>
      {EXIT_DETAIL_FIELD_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={fields.includes(key)}
            onChange={(e) => setFields((prev) => (e.target.checked ? [...prev, key] : prev.filter((k) => k !== key)))}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          {EXIT_DETAIL_FIELDS[key].employeeLabel}
          {requestableFields.includes(key) ? <span className="text-[11px] text-muted-foreground">(flagged missing)</span> : null}
        </label>
      ))}
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={1000} placeholder="Optional note to the employee" className={inputCls} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending !== null || fields.length === 0}
          onClick={async () => (await run('request-exit-details', { fields, message })) && setOpen(false)}
          className={cn(btn, 'bg-primary text-primary-foreground')}
        >
          {pending === 'request-exit-details' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send request
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Employee side: "HR needs a few details to process your exit" — only the requested fields, with
 * the same validation the server runs. Exit type is never on this form. */
export function EmployeeExitDetailsForm({
  request,
  run,
  pending,
  error,
}: {
  request: { id: string; fields: ExitDetailFieldKey[]; message: string | null; requestedBy: string; requestedAt: string }
  run: RunAction
  pending: string | null
  error: string | null
}) {
  const [values, setValues] = useState<Partial<Record<ExitDetailFieldKey, string>>>({})
  const [localError, setLocalError] = useState<string | null>(null)

  async function submit() {
    setLocalError(null)
    const trimmed: Partial<Record<ExitDetailFieldKey, string>> = {}
    for (const key of request.fields) {
      const value = values[key]?.trim() ?? ''
      if (!value) return setLocalError(`${EXIT_DETAIL_FIELDS[key].employeeLabel} is required`)
      trimmed[key] = value
    }
    const problem = validateExitDetailValues(trimmed, { lastWorkingDay: trimmed.lastWorkingDay ?? null, noticeStartDate: trimmed.noticeStartDate ?? null })
    if (problem) return setLocalError(problem)
    await run('submit-exit-details', { request_id: request.id, fields: trimmed })
  }

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">HR needs a few details to process your exit</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Requested by {request.requestedBy} · {formatDateTime(request.requestedAt)}. HR confirms the final last working day.
        </p>
        {request.message ? <p className="mt-2 text-sm text-foreground">HR: “{request.message}”</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {request.fields.map((key) => {
          const field = EXIT_DETAIL_FIELDS[key]
          return (
            <label key={key} className={cn('space-y-1 text-xs font-semibold text-foreground', field.input === 'textarea' && 'sm:col-span-2')}>
              {field.employeeLabel}
              {field.input === 'textarea' ? (
                <textarea
                  rows={2}
                  value={values[key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={inputCls}
                />
              ) : (
                <input
                  type={field.input === 'date' ? 'date' : 'text'}
                  autoComplete="off"
                  value={values[key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={inputCls}
                />
              )}
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={pending !== null} className={cn(btn, 'bg-primary text-primary-foreground')}>
          {pending === 'submit-exit-details' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send to HR
        </button>
        {localError ?? error ? <p className="text-xs font-medium text-destructive">{localError ?? error}</p> : null}
      </div>
    </div>
  )
}

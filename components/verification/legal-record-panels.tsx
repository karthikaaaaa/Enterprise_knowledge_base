'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, ChevronDown, FileSignature, Loader2, ScrollText, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost } from '@/lib/api-client'
import { DraftRecordPanel } from '@/components/verification/finance-record-panels'

/** Legal's agreement + compliance sign-off panels, and the employee's signing card
 * (lib/legal-records.ts). */

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function AgreementText({ title, version, body, defaultOpen = false }: { title: string; version: string; body: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open}>
        <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-xs font-semibold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{version}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-border px-3 py-2 text-xs leading-relaxed text-foreground">
          {body.split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type AgreementResponse = {
  draft: { ready: boolean; blockers: string[]; preview: { title: string; version: string; body: string } | null }
  record: { id: string; title: string; version: string; body: string; createdAt: string; signedName: string | null; signedAt: string | null } | null
}

/** Legal: preview the drafted confidentiality agreement and issue it; then track the signature. */
export function AgreementPanel({ workflowId, readOnly = false, onCreated }: { workflowId: string; readOnly?: boolean; onCreated?: () => void }) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/legal_verification/agreement`
  // While an issued agreement waits on the employee, poll so Legal sees the signature without reloading.
  const { data, error, isLoading, mutate } = useSWR<AgreementResponse>(user ? url : null, authedFetcher(user?.email), {
    refreshInterval: (latest) => (!readOnly && latest?.record && !latest.record.signedAt ? 10000 : 0),
  })
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // When the signature lands, refresh the AI log and the sign-off pack draft it unblocks.
  const signedAt = data?.record?.signedAt ?? null
  const seenUnsigned = useRef(false)
  useEffect(() => {
    if (data?.record && !signedAt) seenUnsigned.current = true
    else if (signedAt && seenUnsigned.current) {
      seenUnsigned.current = false
      onCreated?.()
    }
  }, [data?.record, signedAt, onCreated])

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading agreement…</p>
  if (error || !data) return <p className="text-xs font-medium text-destructive">{error?.message ?? 'Could not load the agreement'}</p>

  const { draft, record } = data
  if (record) {
    const signed = !!record.signedAt
    return (
      <div className={cn('space-y-2 rounded-2xl px-4 py-3', signed ? 'bg-[#e3f4ea]' : 'bg-accent')}>
        <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide', signed ? 'text-[#1f8a52]' : 'text-blue-ink')}>
          {signed ? <Check className="h-3.5 w-3.5" /> : <FileSignature className="h-3.5 w-3.5" />}
          {signed ? 'Agreement signed' : 'Agreement issued — waiting on the employee'}
        </p>
        <p className="text-sm text-foreground">
          Issued {formatDateTime(record.createdAt)}
          {signed ? ` · signed “${record.signedName}” on ${formatDateTime(record.signedAt)}` : ''}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">legal_agreements/{record.id}</p>
        <AgreementText title={record.title} version={record.version} body={record.body} />
      </div>
    )
  }

  async function issue() {
    setPending(true)
    setActionError(null)
    try {
      await authedPost(url, user?.email)
      await mutate()
      onCreated?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to issue the agreement')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileSignature className="h-4 w-4 text-blue-ink" />
        Confidentiality agreement {draft.ready ? '— drafted from verified records' : '— not ready yet'}
      </p>
      {draft.preview ? <AgreementText {...draft.preview} /> : null}
      {draft.blockers.length > 0 ? (
        <div className="rounded-xl bg-yellow-soft px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">
            <AlertTriangle className="h-3.5 w-3.5" />
            Can&apos;t issue yet
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
            Fixed template wording, filled in with the employee&apos;s verified name, role, department and start date. Issuing sends it to the employee to sign.
          </p>
          <button
            type="button"
            onClick={issue}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />}
            Issue agreement to employee
          </button>
        </>
      ) : null}
      {actionError ? <p className="text-xs font-medium text-destructive">{actionError}</p> : null}
    </div>
  )
}

const LEGAL_SNAPSHOT_LABELS: Record<string, string> = {
  offerLetterDocumentId: 'Offer letter',
  governmentIdDocumentId: 'Government ID',
  documentCheckId: 'Document cross-check',
  agreementId: 'Signed agreement',
  submissionId: 'Employee details',
}

export function LegalSignoffPanel({ workflowId, readOnly = false, onCreated }: { workflowId: string; readOnly?: boolean; onCreated?: () => void }) {
  return (
    <DraftRecordPanel<{ snapshot: Record<string, string | null> }>
      url={`/api/workflows/${workflowId}/steps/legal_verification/signoff`}
      icon={<ShieldCheck className="h-4 w-4 text-blue-ink" />}
      title="Compliance sign-off pack"
      createdTitle="Compliance sign-off pack created"
      createLabel="Create compliance sign-off pack"
      readyNote="Offer letter, identity and the signed agreement are all in place. Creating the pack records exactly what you're signing off on."
      recordTable="legal_signoff_records"
      readOnly={readOnly}
      onCreated={onCreated}
      rows={(draft) =>
        Object.entries(LEGAL_SNAPSHOT_LABELS).map(([key, label]) => ({
          label,
          value: draft.snapshot[key]
            ? key === 'documentCheckId'
              ? `${draft.snapshot.documentCheckStatus ?? ''}`
              : key === 'agreementId'
                ? draft.snapshot.agreementSignedAt
                  ? `Signed · ${draft.snapshot.agreementVersion ?? ''}`
                  : 'Issued, not signed'
                : 'On file'
            : 'Missing',
          source: draft.snapshot[key] ?? undefined,
        }))
      }
    />
  )
}

type SignResponse = { agreement: { id: string; title: string; version: string; body: string; issuedAt: string } | null }

/** The employee's "Sign your agreement" card. Renders nothing unless an issued, unsigned agreement
 * exists, so the page is otherwise unchanged. */
export function EmployeeAgreementSignCard({ workflowId }: { workflowId: string }) {
  const { user } = useAuth()
  const url = `/api/workflows/${workflowId}/steps/legal_verification/agreement/sign`
  const { data, mutate } = useSWR<SignResponse>(user ? url : null, authedFetcher(user?.email))
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)

  if (signed) {
    return (
      <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[#1f8a52]">
          <Check className="h-4 w-4" />
          Thanks — your signed agreement was sent to Legal.
        </p>
      </div>
    )
  }

  const agreement = data?.agreement
  if (!agreement) return null

  async function sign() {
    if (!agreement) return
    setPending(true)
    setError(null)
    try {
      await authedPost(url, user?.email, { agreement_id: agreement.id, consent })
      setSigned(true)
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-yellow-ink/20 bg-yellow-soft p-5 shadow-soft">
      <div>
        <p className="text-sm font-semibold text-foreground">Legal needs you to sign your confidentiality agreement</p>
        <p className="mt-1 text-xs text-muted-foreground">Read the agreement, then accept all terms to sign it. Your signature is recorded under the legal name in your employee details.</p>
      </div>
      <AgreementText title={agreement.title} version={agreement.version} body={agreement.body} defaultOpen />
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
        I have read and agree to all the terms of this agreement.
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sign}
          disabled={pending || !consent}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />}
          Accept all terms
        </button>
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}

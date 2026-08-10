'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  Trash2,
  Sparkles,
  Pin,
  Calendar,
  User,
  HardDrive,
  FileStack,
  X,
} from 'lucide-react'
import type { Document } from '@/lib/documents'
import { DocIcon } from '@/components/knowledge/doc-icon'
import { useAuth } from '@/components/auth/auth-provider'
import { canViewDocument } from '@/lib/document-access'

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

export function DocumentDetail({ doc }: { doc: Document & { pathname?: string; mimeType?: string; assetPath?: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (!canViewDocument(user, doc)) {
    return <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-soft"><h1 className="text-lg font-semibold text-foreground">Document access restricted</h1><p className="mt-2 text-sm text-muted-foreground">You can only access HR documents and files owned by your department.</p><Link href="/knowledge-base" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Back to Knowledge Base</Link></div>
  }

  return (
    <div className="space-y-6">
      <Link
        href="/knowledge-base"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Knowledge Base
      </Link>

      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <DocIcon type={doc.type} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {doc.name}
              </h1>
              {doc.pinned ? <Pin className="h-4 w-4 text-blue-ink" /> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-blue-ink">
                {doc.department}
              </span>
              {doc.indexed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink">
                  <Sparkles className="h-3 w-3" /> AI Indexed
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {doc.assetPath || doc.pathname ? <a href={doc.assetPath ?? `/api/documents/file?pathname=${encodeURIComponent(doc.pathname ?? '')}`} download={doc.name} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"><Download className="h-4 w-4" />Download</a> : <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"><Download className="h-4 w-4" />Download</button>}
          <button
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-destructive transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <p className="text-sm font-semibold text-foreground">Preview</p>
              <span className="text-xs text-muted-foreground">{doc.pages} pages</span>
            </div>
            <div className="bg-secondary/50 p-6">
              {doc.assetPath || doc.pathname ? <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-soft">{doc.type === 'pdf' ? <object title={`Preview of ${doc.name}`} data={doc.assetPath ?? `/api/documents/file?pathname=${encodeURIComponent(doc.pathname ?? '')}`} type="application/pdf" className="h-[620px] w-full"><div className="flex h-[620px] flex-col items-center justify-center gap-3 p-8 text-center"><FileStack className="h-10 w-10 text-blue-ink" /><p className="text-sm font-semibold text-foreground">PDF preview unavailable in this browser</p><a className="text-sm font-semibold text-blue-ink underline" href={doc.assetPath ?? `/api/documents/file?pathname=${encodeURIComponent(doc.pathname ?? '')}`} target="_blank" rel="noreferrer">Open PDF in a new tab</a></div></object> : <iframe title={`Preview of ${doc.name}`} src={doc.assetPath?.endsWith('.docx') ? `/api/documents/preview?filename=${encodeURIComponent(doc.assetPath.split('/').pop() ?? '')}` : doc.assetPath ?? `/api/documents/file?pathname=${encodeURIComponent(doc.pathname ?? '')}`} className="h-[620px] w-full" />}</div> : <div className="mx-auto max-w-2xl rounded-2xl bg-card p-8 shadow-soft"><div className="rounded-2xl border border-border bg-secondary/50 p-8 text-center"><FileStack className="mx-auto h-10 w-10 text-blue-ink" /><p className="mt-3 text-sm font-semibold text-foreground">Preview available in the document library</p><p className="mt-1 text-xs text-muted-foreground">This sample document does not have a stored file attached.</p></div></div>}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow text-yellow-ink">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">AI Summary</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{doc.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {doc.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
            <h2 className="text-sm font-semibold text-foreground">Document Information</h2>
            <div className="mt-2 divide-y divide-border">
              <InfoRow icon={FileStack} label="Type" value={doc.type.toUpperCase()} />
              <InfoRow icon={Calendar} label="Uploaded" value={doc.uploadedAt} />
              <InfoRow icon={User} label="Owner" value={doc.owner} />
              <InfoRow icon={HardDrive} label="Size" value={doc.size} />
              <InfoRow icon={FileStack} label="Pages" value={String(doc.pages)} />
            </div>
          </section>

          <section className="rounded-3xl bg-accent p-6">
            <h2 className="text-sm font-semibold text-accent-foreground">Access</h2>
            <p className="mt-2 text-xs leading-relaxed text-blue-ink">
              This document is visible to all employees. Managed by the {doc.department}{' '}
              department.
            </p>
          </section>
        </aside>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm"
            onClick={() => setConfirmOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lift"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ffe6e6] text-destructive">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Delete document?</h2>
                  <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{doc.name}</span> will be permanently
              removed from the knowledge base.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => router.push('/knowledge-base')}
                className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

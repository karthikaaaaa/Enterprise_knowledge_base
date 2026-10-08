'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  Trash2,
  Pencil,
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
import { canViewDocument, type KbAccess } from '@/lib/document-access'
import { authedFetcher } from '@/lib/api-client'

function DocumentPreview({ doc }: { doc: Document & { pathname?: string; mimeType?: string; assetPath?: string } }) {
  const fileUrl = doc.assetPath ?? (doc.pathname ? `/api/documents/file?pathname=${encodeURIComponent(doc.pathname)}` : undefined)

  if (!fileUrl) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl bg-card p-8 shadow-soft">
        <div className="rounded-2xl border border-border bg-secondary/50 p-8 text-center">
          <FileStack className="mx-auto h-10 w-10 text-blue-ink" />
          <p className="mt-3 text-sm font-semibold text-foreground">Preview available in the document library</p>
          <p className="mt-1 text-xs text-muted-foreground">This sample document does not have a stored file attached.</p>
        </div>
      </div>
    )
  }

  const mime = doc.mimeType ?? ''
  const isPdf = mime === 'application/pdf' || doc.type === 'pdf'
  const isImage = mime.startsWith('image/')
  const isWord = mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || doc.assetPath?.endsWith('.docx')
  const isText = mime.startsWith('text/')

  return (
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      {isPdf ? (
        <object title={`Preview of ${doc.name}`} data={fileUrl} type="application/pdf" className="h-[620px] w-full">
          <div className="flex h-[620px] flex-col items-center justify-center gap-3 p-8 text-center">
            <FileStack className="h-10 w-10 text-blue-ink" />
            <p className="text-sm font-semibold text-foreground">PDF preview unavailable in this browser</p>
            <a className="text-sm font-semibold text-blue-ink underline" href={fileUrl} target="_blank" rel="noreferrer">Open PDF in a new tab</a>
          </div>
        </object>
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={`Preview of ${doc.name}`} className="max-h-[620px] w-full bg-secondary/30 object-contain" />
      ) : isWord ? (
        <iframe
          title={`Preview of ${doc.name}`}
          src={doc.pathname ? `/api/documents/preview?pathname=${encodeURIComponent(doc.pathname)}` : `/api/documents/preview?filename=${encodeURIComponent(doc.assetPath?.split('/').pop() ?? '')}`}
          className="h-[620px] w-full"
        />
      ) : isText ? (
        <iframe title={`Preview of ${doc.name}`} src={fileUrl} className="h-[620px] w-full" />
      ) : (
        <div className="flex h-[420px] flex-col items-center justify-center gap-3 p-8 text-center">
          <FileStack className="h-10 w-10 text-blue-ink" />
          <p className="text-sm font-semibold text-foreground">Preview not available for this file type</p>
          <a className="text-sm font-semibold text-blue-ink underline" href={fileUrl} target="_blank" rel="noreferrer">Download to view</a>
        </div>
      )}
    </div>
  )
}

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

export function DocumentDetail({ doc }: { doc: Document & { pathname?: string; mimeType?: string; assetPath?: string; access?: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const { data: kbAccess, isLoading: kbAccessLoading } = useSWR<KbAccess>(
    user ? ['/api/knowledge-base/access', user.email] : null,
    ([url]: [string, string]) => authedFetcher(user?.email)(url),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(doc.name)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')

  async function handleDelete() {
    if (!doc.pathname) { router.push('/knowledge-base'); return }
    setDeleting(true); setDeleteError('')
    try {
      const response = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? 'Delete failed')
      }
      router.push('/knowledge-base')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  async function handleRename() {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenameError('Name cannot be empty'); return }
    if (!doc.pathname) { setRenameOpen(false); return }
    setRenaming(true); setRenameError('')
    try {
      const response = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? 'Rename failed')
      }
      setRenameOpen(false)
      router.refresh()
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setRenaming(false)
    }
  }

  // Wait for the grant check before deciding — otherwise an onboarding Employee would briefly see
  // a document their grant doesn't cover.
  if (kbAccessLoading) return null

  if (!canViewDocument(user, doc, kbAccess)) {
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
            onClick={() => { setRenameValue(doc.name); setRenameError(''); setRenameOpen(true) }}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft"
          >
            <Pencil className="h-4 w-4" />
            Rename
          </button>
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
              <DocumentPreview doc={doc} />
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
            {deleteError ? <p role="alert" className="mt-3 text-sm font-medium text-destructive">{deleteError}</p> : null}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renameOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm"
            onClick={() => setRenameOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lift"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-blue-ink">
                  <Pencil className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Rename document</h2>
                  <p className="text-xs text-muted-foreground">Update the display name.</p>
                </div>
              </div>
              <button
                onClick={() => setRenameOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="mt-4 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/60"
              placeholder="Document name"
            />
            {renameError ? <p role="alert" className="mt-3 text-sm font-medium text-destructive">{renameError}</p> : null}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setRenameOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={renaming}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-60"
              >
                {renaming ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

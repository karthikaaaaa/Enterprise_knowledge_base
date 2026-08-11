'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  Search,
  Upload,
  LayoutGrid,
  List,
  Pin,
  Sparkles,
  Clock,
  ArrowUpRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { documents, departments, type Department, type Document } from '@/lib/documents'
import { DocIcon } from '@/components/knowledge/doc-icon'
import { UploadModal } from '@/components/knowledge/upload-modal'
import { useAuth } from '@/components/auth/auth-provider'
import { canViewDocument } from '@/lib/document-access'

type View = 'grid' | 'list'

function DocCard({ doc, view }: { doc: (typeof documents)[number]; view: View }) {
  if (view === 'list') {
    return (
      <Link
        href={`/knowledge-base/${doc.id}`}
        className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
      >
        <DocIcon type={doc.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{doc.name}</p>
            {doc.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-blue-ink" /> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {doc.department} &middot; {doc.uploadedAt} &middot; {doc.size}
          </p>
        </div>
        {doc.indexed ? (
          <span className="hidden items-center gap-1 rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink sm:inline-flex">
            <Sparkles className="h-3 w-3" /> AI Indexed
          </span>
        ) : null}
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    )
  }

  return (
    <Link
      href={`/knowledge-base/${doc.id}`}
      className="group flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="flex items-start justify-between">
        <DocIcon type={doc.type} size="lg" />
        {doc.pinned ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-blue-ink">
            <Pin className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div>
        <p className="text-sm font-semibold leading-snug text-foreground">{doc.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {doc.department} &middot; {doc.uploadedAt}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{doc.size}</span>
        {doc.indexed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink">
            <Sparkles className="h-3 w-3" /> AI Indexed
          </span>
        ) : (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            Indexing...
          </span>
        )}
      </div>
    </Link>
  )
}

const fetcher = (url: string) => fetch(url).then((response) => response.json())

export function KnowledgeBaseView() {
  const { user } = useAuth()
  const { data, mutate } = useSWR('/api/documents', fetcher, { fallbackData: documents })
  const libraryDocuments = ((data ?? documents) as (Document & { pathname?: string; mimeType?: string })[]).filter((document) => canViewDocument(user, document))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Department | 'All'>('All')
  const [view, setView] = useState<View>('grid')
  const [uploadOpen, setUploadOpen] = useState(false)

  const filtered = useMemo(() => {
    return libraryDocuments.filter((d) => {
      const matchesFilter = filter === 'All' || d.department === filter
      const matchesQuery = d.name.toLowerCase().includes(query.toLowerCase())
      return matchesFilter && matchesQuery
    })
  }, [query, filter])

  const pinned = filtered.filter((d) => d.pinned)
  const recent = filtered

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Search documents by name..."
            className="h-12 w-full rounded-2xl border border-border bg-card pl-11 pr-4 text-sm text-foreground shadow-soft outline-none transition-shadow duration-200 placeholder:text-muted-foreground focus:shadow-lift focus:ring-2 focus:ring-ring/60"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-2xl border border-border bg-card p-1 shadow-soft">
            <button
              onClick={() => setView('grid')}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
                view === 'grid'
                  ? 'bg-accent text-blue-ink'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="sr-only">Grid view</span>
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
                view === 'list'
                  ? 'bg-accent text-blue-ink'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-4 w-4" />
              <span className="sr-only">List view</span>
            </button>
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
          >
            <Upload className="h-4 w-4" />
            Upload Document
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['All', ...departments] as const).map((chip) => (
          <button
            key={chip}
            onClick={() => setFilter(chip)}
            className={cn(
              'rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-200',
              filter === chip
                ? 'border-transparent bg-primary text-primary-foreground shadow-soft'
                : 'border-border bg-card text-muted-foreground hover:-translate-y-0.5 hover:text-foreground hover:shadow-soft',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {pinned.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-blue-ink" />
            <h2 className="text-sm font-semibold text-foreground">Pinned Documents</h2>
          </div>
          <div
            className={cn(
              view === 'grid'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
                : 'flex flex-col gap-3',
            )}
          >
            {pinned.map((doc) => (
              <DocCard key={doc.id} doc={doc} view={view} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-ink" />
          <h2 className="text-sm font-semibold text-foreground">
            {query || filter !== 'All' ? 'Results' : 'Recent Documents'}
          </h2>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {recent.length}
          </span>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm font-medium text-foreground">No documents found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different search or filter.
            </p>
          </div>
        ) : (
          <div
            className={cn(
              view === 'grid'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
                : 'flex flex-col gap-3',
            )}
          >
            {recent.map((doc) => (
              <DocCard key={doc.id} doc={doc} view={view} />
            ))}
          </div>
        )}
      </section>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => mutate()} />
    </div>
  )
}

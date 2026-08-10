'use client'

import { FileText, FileSpreadsheet, FileImage, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

const docs = [
  {
    title: 'Remote Work Policy 2026',
    type: 'PDF',
    icon: FileText,
    tone: 'blue',
    opened: 'Opened 2h ago',
    size: '1.2 MB',
  },
  {
    title: 'Q3 Financial Report',
    type: 'XLSX',
    icon: FileSpreadsheet,
    tone: 'yellow',
    opened: 'Opened yesterday',
    size: '860 KB',
  },
  {
    title: 'Brand Guidelines v3',
    type: 'PDF',
    icon: FileImage,
    tone: 'blue',
    opened: 'Opened 3 days ago',
    size: '4.5 MB',
  },
  {
    title: 'Engineering Onboarding',
    type: 'PDF',
    icon: FileText,
    tone: 'yellow',
    opened: 'Opened last week',
    size: '2.1 MB',
  },
]

export function RecentDocs() {
  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Recently Viewed</h2>
          <p className="text-xs text-muted-foreground">Pick up where you left off</p>
        </div>
        <button className="rounded-full px-3 py-1 text-xs font-semibold text-blue-ink transition-colors hover:bg-accent">
          Browse all
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {docs.map((doc) => {
          const Icon = doc.icon
          return (
            <button
              key={doc.title}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-ring hover:shadow-lift"
            >
              <span
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                  doc.tone === 'blue'
                    ? 'bg-accent text-blue-ink'
                    : 'bg-yellow-soft text-yellow-ink',
                )}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {doc.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {doc.type} · {doc.size}
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {doc.opened}
                </span>
              </span>
              <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

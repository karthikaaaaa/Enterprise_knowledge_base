'use client'

import { Megaphone, ShieldCheck, FileText, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const feed = [
  {
    type: 'Announcement',
    icon: Megaphone,
    tone: 'yellow',
    title: 'All-hands meeting moved to Friday 3 PM',
    meta: 'People Team · 2h ago',
  },
  {
    type: 'Policy Update',
    icon: ShieldCheck,
    tone: 'blue',
    title: 'Updated remote work & travel reimbursement policy',
    meta: 'Operations · 5h ago',
  },
  {
    type: 'New Document',
    icon: FileText,
    tone: 'blue',
    title: '2026 Brand Guidelines v3 published',
    meta: 'Design Team · Yesterday',
  },
  {
    type: 'Announcement',
    icon: Megaphone,
    tone: 'yellow',
    title: 'New security training due by end of month',
    meta: 'Security · 2 days ago',
  },
]

export function CompanyFeed() {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Company Feed</h2>
          <p className="text-xs text-muted-foreground">Latest across your organization</p>
        </div>
        <button className="rounded-full px-3 py-1 text-xs font-semibold text-blue-ink transition-colors hover:bg-accent">
          View all
        </button>
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {feed.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.title}>
              <button className="group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors duration-200 hover:bg-secondary">
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    item.tone === 'blue'
                      ? 'bg-accent text-blue-ink'
                      : 'bg-yellow-soft text-yellow-ink',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.type} · {item.meta}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

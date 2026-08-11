'use client'

import Link from 'next/link'
import { Upload, Sparkles, Users, Workflow, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const cards = [
  {
    title: 'Upload Document',
    desc: 'Add files to your knowledge base',
    icon: Upload,
    tone: 'blue',
    href: '/knowledge-base',
  },
  {
    title: 'AI Assistant',
    desc: 'Ask questions, get instant answers',
    icon: Sparkles,
    tone: 'yellow',
    href: '/ai-chat',
  },
  {
    title: 'Employee Lifecycle',
    desc: 'Onboarding & offboarding flows',
    icon: Users,
    tone: 'blue',
    href: '/automation',
  },
  {
    title: 'Workflow Automation',
    desc: 'Automate repetitive processes',
    icon: Workflow,
    tone: 'yellow',
    href: '/automation',
  },
]

export function QuickAccess() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Link
            key={card.title}
            href={card.href}
            className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl border border-border bg-card p-5 text-left shadow-soft transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
          >
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105',
                card.tone === 'blue'
                  ? 'bg-accent text-blue-ink'
                  : 'bg-yellow-soft text-yellow-ink',
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
                {card.title}
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {card.desc}
              </p>
            </div>
          </Link>
        )
      })}
    </section>
  )
}

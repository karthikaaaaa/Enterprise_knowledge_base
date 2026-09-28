'use client'

import Link from 'next/link'
import { UserPlus, UserMinus, ArrowRight, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WorkflowRequestList } from '@/components/automation/workflow-request-list'

const cards = [
  {
    title: 'Employee Onboarding',
    desc: 'Automate employee joining from document submission to account creation.',
    icon: UserPlus,
    href: '/automation/onboarding',
    tone: 'blue',
    points: ['Document verification', 'Approvals', 'Account & asset setup'],
  },
  {
    title: 'Employee Offboarding',
    desc: 'Automate employee exit, approvals, knowledge transfer and account deactivation.',
    icon: UserMinus,
    href: '/automation/offboarding',
    tone: 'yellow',
    points: ['Exit approvals', 'Knowledge transfer', 'Access deactivation'],
  },
]

export function AutomationLanding() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.title}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-soft transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
            >
              <div
                className={cn(
                  'pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-60 blur-2xl',
                  card.tone === 'blue' ? 'bg-blue' : 'bg-yellow-soft',
                )}
              />
              <div className="relative flex flex-1 flex-col">
                <div
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105',
                    card.tone === 'blue'
                      ? 'bg-accent text-blue-ink'
                      : 'bg-yellow text-yellow-ink',
                  )}
                >
                  <Icon className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
                  {card.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.desc}</p>
                <ul className="mt-5 space-y-2">
                  {card.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-blue-ink" />
                      {p}
                    </li>
                  ))}
                </ul>
                <Link
                  href={card.href}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                >
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      <WorkflowRequestList />
    </div>
  )
}

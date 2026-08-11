'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Loader2,
  Circle,
  ChevronDown,
  Eye,
  User,
  Briefcase,
  Calendar,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkflowStep } from '@/lib/workflows'

const statusConfig = {
  completed: {
    label: 'Completed',
    badge: 'bg-[#e4f7ec] text-[#1f8a52]',
    ring: 'bg-[#1f8a52] text-white',
    icon: Check,
  },
  'in-progress': {
    label: 'In Progress',
    badge: 'bg-yellow-soft text-yellow-ink',
    ring: 'bg-yellow text-yellow-ink',
    icon: Loader2,
  },
  pending: {
    label: 'Pending',
    badge: 'bg-secondary text-muted-foreground',
    ring: 'bg-secondary text-muted-foreground',
    icon: Circle,
  },
} as const

type Employee = { name: string; role: string; date: string; label: string }

export function WorkflowTimeline({
  employee,
  steps,
}: {
  employee: Employee
  steps: WorkflowStep[]
}) {
  const [expanded, setExpanded] = useState<number | null>(
    steps.findIndex((s) => s.status === 'in-progress'),
  )
  const [detailStep, setDetailStep] = useState<WorkflowStep | null>(null)

  const completed = steps.filter((s) => s.status === 'completed').length
  const percent = Math.round((completed / steps.length) * 100)

  return (
    <div className="space-y-6">
      <Link
        href="/automation"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Automation
      </Link>

      {/* Employee info */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-blue-ink">
              {employee.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </div>
            <div>
              <span className="rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink">
                {employee.label}
              </span>
              <h2 className="mt-1.5 text-lg font-semibold text-foreground">{employee.name}</h2>
              <p className="text-sm text-muted-foreground">{employee.role}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:gap-8">
            <Stat icon={Briefcase} label="Role" value={employee.role.split(' ')[0]} />
            <Stat icon={Calendar} label="Started" value={employee.date} />
            <Stat icon={User} label="Steps" value={`${completed}/${steps.length}`} />
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span className="text-muted-foreground">Overall progress</span>
            <span className="text-foreground">{percent}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <ol className="relative space-y-4">
        {steps.map((step, i) => {
          const config = statusConfig[step.status]
          const StatusIcon = config.icon
          const isOpen = expanded === i
          const isLast = i === steps.length - 1
          return (
            <li key={step.title} className="relative pl-14">
              {!isLast ? (
                <span
                  className={cn(
                    'absolute left-[22px] top-11 h-[calc(100%+1rem)] w-0.5',
                    step.status === 'completed' ? 'bg-primary/40' : 'bg-border',
                  )}
                  aria-hidden
                />
              ) : null}
              <span
                className={cn(
                  'absolute left-0 top-2 flex h-11 w-11 items-center justify-center rounded-2xl shadow-soft',
                  config.ring,
                )}
              >
                <StatusIcon
                  className={cn('h-5 w-5', step.status === 'in-progress' && 'animate-spin')}
                />
              </span>

              <div className="rounded-3xl border border-border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                          config.badge,
                        )}
                      >
                        {config.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  <button
                    onClick={() => setExpanded(isOpen ? null : i)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Expand step"
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                    />
                  </button>
                </div>

                {isOpen ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {step.details}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        {step.meta}
                      </span>
                      <button
                        onClick={() => setDetailStep(step)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-blue-ink transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Details
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {detailStep ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm"
            onClick={() => setDetailStep(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lift"
          >
            <div className="flex items-start justify-between">
              <div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                    statusConfig[detailStep.status].badge,
                  )}
                >
                  {statusConfig[detailStep.status].label}
                </span>
                <h2 className="mt-2 text-lg font-semibold text-foreground">{detailStep.title}</h2>
              </div>
              <button
                onClick={() => setDetailStep(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {detailStep.details}
            </p>
            <div className="mt-4 rounded-2xl bg-secondary px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">{detailStep.meta}</p>
            </div>
            <button
              onClick={() => setDetailStep(null)}
              className="mt-6 w-full rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User
  label: string
  value: string
}) {
  return (
    <div className="text-center sm:text-left">
      <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground sm:justify-start">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher } from '@/lib/api-client'
import { humanizeStepName, formatWorkflowDate } from '@/lib/workflow-format'
import type { WorkflowSummary } from '@/lib/workflow-view'

function typeLabel(type: string) {
  return type === 'onboarding' ? 'Onboarding' : 'Offboarding'
}

/** The "Recent Requests" list, reused as-is on /automation (all workflows) and filtered by
 * `typeFilter` on /automation/onboarding and /automation/offboarding. */
export function WorkflowRequestList({
  typeFilter,
  heading = 'Recent Requests',
  emptyMessage = 'No requests yet.',
}: {
  typeFilter?: 'onboarding' | 'offboarding'
  heading?: string
  emptyMessage?: string
}) {
  const { user } = useAuth()
  const { data, isLoading, error } = useSWR<{ workflows: WorkflowSummary[] }>(
    user ? '/api/workflows' : null,
    authedFetcher(user?.email),
  )
  const workflows = (data?.workflows ?? []).filter((wf) => !typeFilter || wf.type === typeFilter)

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-blue-ink" />
        <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
      </div>
      <div className="relative space-y-4 pl-6">
        <span className="absolute left-[7px] top-2 h-[calc(100%-1rem)] w-0.5 bg-border" aria-hidden />
        {isLoading ? <p className="text-sm text-muted-foreground">Loading requests…</p> : null}
        {error ? <p className="text-sm text-destructive">Couldn&apos;t load requests. Please try again.</p> : null}
        {!isLoading && !error && workflows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}
        {workflows.map((wf) => (
          <Link key={wf.id} href={`/automation/${wf.type}/${wf.id}`} className="relative block">
            <span
              className={cn(
                'absolute -left-6 top-6 h-3.5 w-3.5 rounded-full ring-4 ring-background',
                wf.progress.percent === 100 ? 'bg-[#1f8a52]' : 'bg-primary',
              )}
              aria-hidden
            />
            <div className="rounded-3xl border border-border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-blue-ink">
                    {wf.employee.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{wf.employee.name}</p>
                    <p className="text-xs text-muted-foreground">{wf.employee.department ?? wf.employee.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      wf.type === 'onboarding' ? 'bg-accent text-blue-ink' : 'bg-yellow-soft text-yellow-ink',
                    )}
                  >
                    {typeLabel(wf.type)}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatWorkflowDate(wf.createdAt)}</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      wf.progress.percent === 100 ? 'bg-[#1f8a52]' : 'bg-primary',
                    )}
                    style={{ width: `${wf.progress.percent}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs font-medium text-muted-foreground">
                  {wf.currentStep ? humanizeStepName(wf.currentStep.stepName) : 'Completed'}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

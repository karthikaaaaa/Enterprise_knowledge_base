'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { PageHeader } from '@/components/dashboard/page-header'
import { WorkflowRequestList } from '@/components/automation/workflow-request-list'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher } from '@/lib/api-client'
import type { WorkflowSummary } from '@/lib/workflow-view'

type AutomationType = 'onboarding' | 'offboarding'

const COPY: Record<AutomationType, { eyebrow: string; title: string; description: string; empty: string }> = {
  onboarding: {
    eyebrow: 'Onboarding',
    title: 'Employee Onboarding',
    description: 'Track every onboarding journey from document submission to full access.',
    empty: 'No onboarding workflows yet.',
  },
  offboarding: {
    eyebrow: 'Offboarding',
    title: 'Employee Offboarding',
    description: 'Track every exit journey from request through knowledge transfer to deactivation.',
    empty: 'No offboarding workflows yet.',
  },
}

/** The type-scoped landing behind /automation/onboarding and /automation/offboarding — same
 * data as the combined /automation view, filtered down to just this workflow type. */
export function AutomationTypeLanding({ type }: { type: AutomationType }) {
  const { user } = useAuth()
  const router = useRouter()
  const isEmployee = user?.role === 'employee'
  const copy = COPY[type]

  const { data, isLoading } = useSWR<{ workflows: WorkflowSummary[] }>(
    isEmployee && user ? '/api/workflows' : null,
    authedFetcher(user?.email),
  )

  useEffect(() => {
    if (!isEmployee || !data) return
    const own = data.workflows.find((wf) => wf.type === type) ?? data.workflows[0]
    if (own) router.replace(`/automation/${own.type}/${own.id}`)
  }, [isEmployee, data, router, type])

  if (isEmployee) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        {!isLoading && data && !data.workflows.some((wf) => wf.type === type) ? (
          <p className="text-sm text-muted-foreground">No {type} workflow has been started for your account yet.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading your workflow…</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      <WorkflowRequestList typeFilter={type} heading={`${copy.title} Requests`} emptyMessage={copy.empty} />
    </div>
  )
}

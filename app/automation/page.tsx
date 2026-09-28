'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { PageHeader } from '@/components/dashboard/page-header'
import { AutomationLanding } from '@/components/automation/automation-landing'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher } from '@/lib/api-client'
import type { WorkflowSummary } from '@/lib/workflow-view'

export default function AutomationPage() {
  const { user } = useAuth()
  const router = useRouter()
  const isEmployee = user?.role === 'employee'

  // Employees don't get the HR/Manager landing list — they're routed straight to their own workflow.
  const { data, isLoading } = useSWR<{ workflows: WorkflowSummary[] }>(
    isEmployee && user ? '/api/workflows' : null,
    authedFetcher(user?.email),
  )

  useEffect(() => {
    if (!isEmployee || !data) return
    const own = data.workflows[0]
    if (own) router.replace(`/automation/${own.type}/${own.id}`)
  }, [isEmployee, data, router])

  if (isEmployee) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Employee Automation"
          title="My Onboarding"
          description="Track the progress of your own onboarding journey."
        />
        {!isLoading && data && data.workflows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No onboarding or offboarding workflow has been started for your account yet.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading your workflow…</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Employee Automation"
        title="Automate the employee lifecycle"
        description="Streamline joining and exit journeys with guided, AI-assisted workflows that keep HR, IT, and Finance in sync."
      />
      <AutomationLanding />
    </div>
  )
}

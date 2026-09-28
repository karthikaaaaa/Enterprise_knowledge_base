import { PageHeader } from '@/components/dashboard/page-header'
import { WorkflowDetailView } from '@/components/automation/workflow-detail-view'

export default async function OnboardingWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Onboarding"
        title="Employee Onboarding Workflow"
        description="Track every stage of the joining journey from document submission to full access."
      />
      <WorkflowDetailView workflowId={id} />
    </div>
  )
}

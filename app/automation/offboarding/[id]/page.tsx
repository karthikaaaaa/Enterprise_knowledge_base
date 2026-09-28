import { PageHeader } from '@/components/dashboard/page-header'
import { WorkflowDetailView } from '@/components/automation/workflow-detail-view'

export default async function OffboardingWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Offboarding"
        title="Employee Offboarding Workflow"
        description="Manage a smooth exit from request through knowledge transfer to account deactivation."
      />
      <WorkflowDetailView workflowId={id} />
    </div>
  )
}

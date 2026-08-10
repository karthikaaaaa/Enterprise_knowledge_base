import { PageHeader } from '@/components/dashboard/page-header'
import { WorkflowTimeline } from '@/components/automation/workflow-timeline'
import { offboardingSteps } from '@/lib/workflows'

export default function OffboardingPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Offboarding" title="Employee Offboarding Workflow" description="Manage a smooth exit from request through knowledge transfer to account deactivation." /><WorkflowTimeline employee={{ name: 'Mei Tanaka', role: 'Sales Manager', date: 'Feb 08, 2025', label: 'Exiting' }} steps={offboardingSteps} /></div>
}

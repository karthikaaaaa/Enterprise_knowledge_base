import { PageHeader } from '@/components/dashboard/page-header'
import { WorkflowTimeline } from '@/components/automation/workflow-timeline'
import { onboardingSteps } from '@/lib/workflows'

export default function OnboardingPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Onboarding" title="Employee Onboarding Workflow" description="Track every stage of the joining journey from document submission to full access." /><WorkflowTimeline employee={{ name: 'Elena Petrova', role: 'Product Designer', date: 'Feb 10, 2025', label: 'New Hire' }} steps={onboardingSteps} /></div>
}

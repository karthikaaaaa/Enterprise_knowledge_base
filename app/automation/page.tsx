import { PageHeader } from '@/components/dashboard/page-header'
import { AutomationLanding } from '@/components/automation/automation-landing'

export default function AutomationPage() {
  return <div className="space-y-8"><PageHeader eyebrow="Employee Automation" title="Automate the employee lifecycle" description="Streamline joining and exit journeys with guided, AI-assisted workflows that keep HR, IT, and Finance in sync." /><AutomationLanding /></div>
}

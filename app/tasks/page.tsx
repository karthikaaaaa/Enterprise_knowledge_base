import { PageHeader } from '@/components/dashboard/page-header'
import { TasksView } from '@/components/tasks/tasks-view'

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Department Tasks"
        title="Your assigned tasks"
        description="Work assigned to your department across every employee's onboarding and offboarding journey."
      />
      <TasksView />
    </div>
  )
}

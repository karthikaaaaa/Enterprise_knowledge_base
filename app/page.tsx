import { AppShell } from '@/components/dashboard/app-shell'
import { Hero } from '@/components/dashboard/hero'
import { QuickAccess } from '@/components/dashboard/quick-access'
import { CompanyFeed } from '@/components/dashboard/company-feed'
import { AiAssistant } from '@/components/dashboard/ai-assistant'
import { RecentDocs } from '@/components/dashboard/recent-docs'
import { MyTasks } from '@/components/dashboard/my-tasks'

export default function Page() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Hero />
        <QuickAccess />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <CompanyFeed />
          </div>
          <div className="xl:col-span-1">
            <MyTasks />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <RecentDocs />
          </div>
          <div className="xl:col-span-1">
            <AiAssistant />
          </div>
        </div>
      </div>
    </AppShell>
  )
}

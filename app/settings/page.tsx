import { AppShell } from '@/components/dashboard/app-shell'
import { PageHeader } from '@/components/dashboard/page-header'
import { SettingsView } from '@/components/settings/settings-view'

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          description="Manage your profile, appearance, notifications, and security."
        />
        <SettingsView />
      </div>
    </AppShell>
  )
}

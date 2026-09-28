import type { ReactNode } from 'react'
import { AppShell } from '@/components/dashboard/app-shell'
import { RoleGuard } from '@/components/auth/role-guard'

export default function AutomationLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <RoleGuard
        roles={['admin', 'hr', 'employee']}
        message="Automation workflows are available to Admin, HR, and Employee accounts. Manager approvals now live under Tasks — sign in with a role that has workflow access to continue."
      >
        {children}
      </RoleGuard>
    </AppShell>
  )
}

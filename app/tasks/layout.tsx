import type { ReactNode } from 'react'
import { AppShell } from '@/components/dashboard/app-shell'
import { RoleGuard } from '@/components/auth/role-guard'

export default function TasksLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <RoleGuard
        roles={['it', 'finance', 'legal', 'manager']}
        message="The Tasks queue is available to IT, Finance, Legal, and Manager accounts. Sign in with a department account to continue."
      >
        {children}
      </RoleGuard>
    </AppShell>
  )
}

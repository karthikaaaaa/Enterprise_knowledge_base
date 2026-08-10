import type { ReactNode } from 'react'
import { AppShell } from '@/components/dashboard/app-shell'
import { RoleGuard } from '@/components/auth/role-guard'

export default function AutomationLayout({ children }: { children: ReactNode }) {
  return <AppShell><RoleGuard roles={['admin', 'hr', 'manager']}>{children}</RoleGuard></AppShell>
}

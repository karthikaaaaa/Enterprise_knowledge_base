'use client'

import type { ReactNode } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useAuth, type Role } from './auth-provider'

export function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (user && roles.includes(user.role)) return <>{children}</>
  return <div className="mx-auto flex max-w-xl flex-col items-center rounded-3xl border border-border bg-card p-10 text-center shadow-soft"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-soft text-yellow-ink"><LockKeyhole className="h-6 w-6" /></div><h1 className="mt-5 text-2xl font-semibold">This area is restricted</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Automation workflows are available to Admin, HR, and Manager accounts. Sign in with a role that has workflow access to continue.</p></div>
}

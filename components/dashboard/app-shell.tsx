'use client'

import type { ReactNode } from 'react'
import { BookOpen, LoaderCircle } from 'lucide-react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Topbar } from '@/components/dashboard/topbar'
import { useAuth } from '@/components/auth/auth-provider'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 rounded-2xl bg-card px-5 py-4 text-sm text-muted-foreground shadow-soft"><LoaderCircle className="h-4 w-4 animate-spin text-blue-ink" />Loading workspace</div></div>
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col"><Topbar /><main className="flex-1 px-5 py-6 md:px-8 md:py-8">{children}</main></div>
    </div>
  )
}

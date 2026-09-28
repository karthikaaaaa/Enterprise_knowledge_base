'use client'

import { Search, ChevronDown, Menu, LogOut } from 'lucide-react'
import { useAuth, DEFAULT_AVATAR } from '@/components/auth/auth-provider'
import { NotificationBell } from '@/components/dashboard/notification-bell'

export function Topbar() {
  const { user, logout } = useAuth()
  return <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-border bg-background/80 px-5 py-4 backdrop-blur-xl md:px-8">
    <div className="flex items-center gap-2 lg:hidden"><button type="button" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-soft transition-colors hover:text-foreground"><Menu className="h-5 w-5" /><span className="sr-only">Open menu</span></button><button type="button" onClick={logout} aria-label="Log out" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:text-foreground hover:shadow-lift"><LogOut className="h-4 w-4" /><span className="sr-only">Log out</span></button></div>
    <div className="relative max-w-xl flex-1"><Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="search" placeholder="Search across your workspace..." className="h-11 w-full rounded-2xl border border-border bg-card pl-11 pr-4 text-sm text-foreground shadow-soft outline-none transition-shadow placeholder:text-muted-foreground focus:shadow-lift focus:ring-2 focus:ring-ring/60" /></div>
    <div className="ml-auto flex items-center gap-3"><NotificationBell /><details className="relative"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-card py-1.5 pl-1.5 pr-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift"><img src={user?.avatar ?? DEFAULT_AVATAR} alt={user?.name ?? 'User'} className="h-8 w-8 rounded-xl object-cover" /><div className="hidden text-left leading-tight sm:block"><p className="text-xs font-semibold text-foreground">{user?.name}</p><p className="text-[11px] capitalize text-muted-foreground">{user?.role}</p></div><ChevronDown className="h-4 w-4 text-muted-foreground" /></summary><div className="absolute right-0 top-14 w-44 rounded-2xl border border-border bg-card p-2 shadow-lift"><button type="button" onClick={logout} aria-label="Log out of KnowledgeOS" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><LogOut className="h-4 w-4" />Sign out</button></div></details></div>
  </header>
}

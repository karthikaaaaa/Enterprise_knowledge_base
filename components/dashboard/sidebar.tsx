'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Library, Sparkles, Users, Settings, BookOpen, LifeBuoy, LogOut, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, type Role } from '@/components/auth/auth-provider'

const nav: { label: string; icon: typeof LayoutDashboard; href: string; roles?: Role[] }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { label: 'Knowledge Base', icon: Library, href: '/knowledge-base' },
  { label: 'AI Chat', icon: Sparkles, href: '/ai-chat' },
  { label: 'Automation', icon: Users, href: '/automation', roles: ['admin', 'hr', 'manager'] },
  { label: 'Settings', icon: Settings, href: '/settings' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const visibleNav = nav.filter((item) => !item.roles || (user && item.roles.includes(user.role)))

  return <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-sidebar-border bg-sidebar px-5 py-7 lg:flex">
    <Link href="/" className="flex items-center gap-3 px-2"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft"><BookOpen className="h-5 w-5" /></div><div className="leading-tight"><p className="text-sm font-semibold text-foreground">KnowledgeOS</p><p className="text-xs text-muted-foreground">Enterprise</p></div></Link>
    <div className="rounded-2xl border border-border bg-card/70 p-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-ink" /><span className="text-xs font-semibold">{user?.role === 'admin' ? 'Admin' : user?.role === 'hr' ? 'People Operations' : user?.department}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</p></div>
    <nav className="flex flex-1 flex-col gap-1">{visibleNav.map((item) => { const Icon = item.icon; const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href); return <Link key={item.label} href={item.href} className={cn('group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200', active ? 'bg-accent text-accent-foreground shadow-soft' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}><Icon className={cn('h-[18px] w-[18px]', active ? 'text-blue-ink' : 'text-muted-foreground group-hover:text-foreground')} />{item.label}</Link> })}</nav>
    <div className="rounded-3xl bg-yellow-soft p-4"><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-yellow text-yellow-ink"><LifeBuoy className="h-4 w-4" /></div><p className="text-sm font-semibold text-foreground">Need help?</p></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Explore docs or contact our support team anytime.</p><button className="mt-3 w-full rounded-xl bg-yellow px-3 py-2 text-xs font-semibold text-yellow-ink transition-transform hover:-translate-y-0.5">Get Support</button></div>
    <button type="button" onClick={logout} aria-label="Log out of KnowledgeOS" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"><LogOut className="h-[18px] w-[18px]" />Sign out</button>
  </aside>
}

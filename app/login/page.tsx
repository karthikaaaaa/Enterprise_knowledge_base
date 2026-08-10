'use client'

import { useState } from 'react'
import { ArrowRight, BookOpen, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { DEMO_USERS, type Role, useAuth } from '@/components/auth/auth-provider'

const roleLabels: Record<Role, string> = { admin: 'Admin', hr: 'HR Manager', manager: 'IT / Engineering', finance: 'Finance', legal: 'Legal', employee: 'Employee' }

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('amara@knowledgeos.demo')
  const [password, setPassword] = useState('Admin123!')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(login(email, password) ? '' : 'That email and password combination is not valid.')
  }

  function choose(user: typeof DEMO_USERS[number]) {
    setEmail(user.email)
    setPassword(user.password)
    setError('')
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 md:px-10">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-border bg-card shadow-lift lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden bg-blue-soft p-12 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft"><BookOpen className="h-5 w-5" /></div>
              <div><p className="font-semibold text-foreground">KnowledgeOS</p><p className="text-xs text-muted-foreground">Enterprise workspace</p></div>
            </div>
            <div className="mt-24 max-w-md">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-ink">One workspace. Every answer.</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight text-foreground">Make company knowledge feel effortless.</h1>
              <p className="mt-5 text-base leading-7 text-muted-foreground">Explore documents, automate employee journeys, and give every teammate a trusted place to find what they need.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {['AI-powered search', 'Role-aware access', 'Smart workflows'].map((item) => <div key={item} className="rounded-2xl border border-border bg-card/80 p-3 text-xs font-semibold text-foreground"><Check className="mb-2 h-4 w-4 text-blue-ink" />{item}</div>)}
          </div>
        </section>

        <section className="p-7 md:p-12">
          <div className="mx-auto max-w-md">
            <div className="mb-10 lg:hidden"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><BookOpen className="h-5 w-5" /></div><p className="font-semibold">KnowledgeOS</p></div></div>
            <p className="text-sm font-semibold text-blue-ink">Welcome back</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to your workspace</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Use one of the demo accounts below to explore each role.</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <label className="block"><span className="mb-2 block text-sm font-medium">Work email</span><div className="relative"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="h-12 w-full rounded-2xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring/50" /></div></label>
              <label className="block"><span className="mb-2 block text-sm font-medium">Password</span><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} className="h-12 w-full rounded-2xl border border-border bg-background pl-10 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/50" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">Sign in <ArrowRight className="h-4 w-4" /></button>
            </form>
            <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-blue-ink" />Demo access only — credentials are shown for testing.</div>
            <div className="mt-6 space-y-2">
              {DEMO_USERS.map((user) => <button type="button" key={user.id} onClick={() => choose(user)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-soft"><span><span className="block text-sm font-semibold">{user.name}</span><span className="block text-xs text-muted-foreground">{user.email}</span></span><span className="rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink">{roleLabels[user.role]}</span></button>)}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type Role = 'admin' | 'hr' | 'manager' | 'it' | 'finance' | 'legal' | 'employee'
export type DemoUser = {
  id: string
  name: string
  email: string
  password: string
  role: Role
  department: string
  title: string
  /** Falls back to the shared generic avatar (/avatars/user.png) when not set. */
  avatar?: string
}

export const DEFAULT_AVATAR = '/avatars/user.png'

export const DEMO_USERS: DemoUser[] = [
  { id: 'amara', name: 'Amara Okafor', email: 'amara@knowledgeos.demo', password: 'Admin123!', role: 'admin', department: 'Operations', title: 'Workspace Admin' },
  { id: 'priya', name: 'Priya Nair', email: 'priya@knowledgeos.demo', password: 'HR123456!', role: 'hr', department: 'People Operations', title: 'HR Manager' },
  { id: 'diego', name: 'Diego Ramirez', email: 'diego@knowledgeos.demo', password: 'Manager123!', role: 'manager', department: 'Engineering', title: 'Engineering Manager' },
  { id: 'rahul', name: 'Rahul Mehta', email: 'rahul@knowledgeos.demo', password: 'ITHead123!', role: 'it', department: 'IT', title: 'IT Head' },
  { id: 'fatima', name: 'Fatima Ali', email: 'fatima@knowledgeos.demo', password: 'Finance123!', role: 'finance', department: 'Finance', title: 'Finance Analyst' },
  { id: 'lucas', name: 'Lucas Meyer', email: 'lucas@knowledgeos.demo', password: 'Legal123!', role: 'legal', department: 'Legal', title: 'Legal Counsel' },
  { id: 'elena', name: 'Elena Petrova', email: 'elena@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Product', title: 'Product Designer', avatar: '/avatars/elena-petrova.png' },
  { id: 'james', name: 'James Okoro', email: 'james@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Engineering', title: 'Backend Engineer' },
  { id: 'mei', name: 'Mei Tanaka', email: 'mei@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Sales', title: 'Sales Manager' },
]

export type LoginResult = 'ok' | 'invalid' | 'deactivated'
/** Server-side account state: deactivated accounts can't sign in; 'exiting' employees get the
 * restricted offboarding navigation. */
export type AccountStatus = { active: boolean; offboarding: 'exiting' | 'exited' | null }

type AuthContextValue = {
  user: DemoUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  logout: () => void
  can: (roles: Role[]) => boolean
  accountStatus: AccountStatus | null
}

async function fetchAccountStatus(email: string): Promise<AccountStatus | null> {
  try {
    const response = await fetch('/api/auth/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
    if (!response.ok) return null
    const body = (await response.json()) as { exists: boolean; active: boolean; offboarding: AccountStatus['offboarding'] }
    return body.exists ? { active: body.active, offboarding: body.offboarding } : null
  } catch {
    return null
  }
}
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const id = window.sessionStorage.getItem('knowledgeos-demo-user')
    if (id) setUser(DEMO_USERS.find((candidate) => candidate.id === id) ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') router.replace('/login')
  }, [loading, pathname, router, user])

  // Re-check the account on every page change: an account deactivated mid-session (exit completed)
  // is signed out, and an exiting employee is kept to their offboarding pages.
  useEffect(() => {
    if (!user) {
      setAccountStatus(null)
      return
    }
    let cancelled = false
    void fetchAccountStatus(user.email).then((status) => {
      if (cancelled) return
      setAccountStatus(status)
      if (status && !status.active) {
        window.sessionStorage.removeItem('knowledgeos-demo-user')
        setUser(null)
        router.replace('/login')
      } else if (status?.offboarding === 'exiting' && (pathname === '/' || pathname.startsWith('/settings'))) {
        router.replace('/automation')
      }
    })
    return () => {
      cancelled = true
    }
  }, [user, pathname, router])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: async (email, password) => {
      const match = DEMO_USERS.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase() && candidate.password === password)
      if (!match) return 'invalid'
      const status = await fetchAccountStatus(match.email)
      if (status && !status.active) return 'deactivated'
      window.sessionStorage.setItem('knowledgeos-demo-user', match.id)
      setUser(match)
      router.replace(status?.offboarding === 'exiting' ? '/automation' : '/')
      return 'ok'
    },
    logout: () => {
      window.sessionStorage.removeItem('knowledgeos-demo-user')
      setUser(null)
      router.replace('/login')
    },
    can: (roles) => !!user && roles.includes(user.role),
    accountStatus,
  }), [accountStatus, loading, router, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

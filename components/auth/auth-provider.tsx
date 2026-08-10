'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type Role = 'admin' | 'hr' | 'manager' | 'finance' | 'legal' | 'employee'
export type DemoUser = { id: string; name: string; email: string; password: string; role: Role; department: string; title: string }

export const DEMO_USERS: DemoUser[] = [
  { id: 'amara', name: 'Amara Okafor', email: 'amara@knowledgeos.demo', password: 'Admin123!', role: 'admin', department: 'Operations', title: 'Workspace Admin' },
  { id: 'priya', name: 'Priya Nair', email: 'priya@knowledgeos.demo', password: 'HR123456!', role: 'hr', department: 'People Operations', title: 'HR Manager' },
  { id: 'diego', name: 'Diego Ramirez', email: 'diego@knowledgeos.demo', password: 'Manager123!', role: 'manager', department: 'Engineering', title: 'Engineering Manager' },
  { id: 'fatima', name: 'Fatima Ali', email: 'fatima@knowledgeos.demo', password: 'Finance123!', role: 'finance', department: 'Finance', title: 'Finance Analyst' },
  { id: 'lucas', name: 'Lucas Meyer', email: 'lucas@knowledgeos.demo', password: 'Legal123!', role: 'legal', department: 'Legal', title: 'Legal Counsel' },
  { id: 'elena', name: 'Elena Petrova', email: 'elena@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Product', title: 'Product Designer' },
  { id: 'james', name: 'James Okoro', email: 'james@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Engineering', title: 'Backend Engineer' },
  { id: 'mei', name: 'Mei Tanaka', email: 'mei@knowledgeos.demo', password: 'Employee123!', role: 'employee', department: 'Sales', title: 'Sales Manager' },
]

type AuthContextValue = { user: DemoUser | null; loading: boolean; login: (email: string, password: string) => boolean; logout: () => void; can: (roles: Role[]) => boolean }
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(null)
  const [loading, setLoading] = useState(true)
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

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: (email, password) => {
      const match = DEMO_USERS.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase() && candidate.password === password)
      if (!match) return false
      window.sessionStorage.setItem('knowledgeos-demo-user', match.id)
      setUser(match)
      router.replace('/')
      return true
    },
    logout: () => {
      window.sessionStorage.removeItem('knowledgeos-demo-user')
      setUser(null)
      router.replace('/login')
    },
    can: (roles) => !!user && roles.includes(user.role),
  }), [loading, router, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

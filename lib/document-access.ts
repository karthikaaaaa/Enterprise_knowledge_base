import type { DemoUser, Role } from '@/components/auth/auth-provider'
import type { Document } from '@/lib/documents'

const departmentAliases: Record<string, string> = {
  'People Operations': 'HR',
  Operations: 'Policies',
  Engineering: 'IT',
  Product: 'Policies',
  Sales: 'Finance',
}

export function canViewDocument(user: DemoUser | null, document: Pick<Document, 'department'>) {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'hr') return true
  const ownDepartment = departmentAliases[user.department] ?? user.department
  return document.department === 'HR' || document.department === ownDepartment
}

export function allowedDocumentDepartments(user: DemoUser | null): Document['department'][] {
  if (!user) return []
  if (user.role === 'admin' || user.role === 'hr') return ['HR', 'IT', 'Finance', 'Legal', 'Policies']
  const ownDepartment = departmentAliases[user.department] ?? user.department
  return ['HR', ownDepartment] as Document['department'][]
}

export const departmentLoginRoles: Array<{ department: string; roles: Role[] }> = [
  { department: 'HR', roles: ['hr'] },
  { department: 'IT / Engineering', roles: ['manager', 'employee'] },
  { department: 'Finance / Sales', roles: ['employee'] },
  { department: 'Legal', roles: ['admin'] },
]

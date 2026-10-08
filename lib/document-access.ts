import type { DemoUser, Role } from '@/components/auth/auth-provider'
import type { Document } from '@/lib/documents'

const departmentAliases: Record<string, string> = {
  'People Operations': 'HR',
  Operations: 'Policies',
  Engineering: 'IT',
  Product: 'Policies',
  Sales: 'Finance',
}

/** Per-employee Knowledge Base grants layered on top of the role/department rules below (see
 * lib/kb-access.ts for how it's resolved server-side, GET /api/knowledge-base/access for the
 * client). `restricted: true` replaces those rules entirely: only documents whose category
 * (department) is in `categories` are visible — an empty list means nothing is. */
export type KbAccess = { restricted: false } | { restricted: true; categories: string[] }

export function canViewDocument(
  user: DemoUser | null,
  document: Pick<Document, 'department'> & { access?: string },
  kbAccess?: KbAccess,
) {
  if (!user) return false
  if (kbAccess?.restricted) return kbAccess.categories.includes(document.department)
  if (user.role === 'admin' || user.role === 'hr') return true
  if (document.access === 'Admins only') return false
  if (document.access === 'All employees') return true
  const ownDepartment = departmentAliases[user.department] ?? user.department
  return document.department === 'HR' || document.department === ownDepartment
}

/** Which department chips show in the Knowledge Base section navigation, for this user's role. */
export function allowedDocumentDepartments(user: DemoUser | null, kbAccess?: KbAccess): Document['department'][] {
  if (!user) return []
  if (kbAccess?.restricted) return kbAccess.categories as Document['department'][]
  if (user.role === 'admin' || user.role === 'hr') return ['HR', 'IT', 'Finance', 'Legal', 'Policies']
  if (user.role === 'employee') return ['Policies']
  const ownDepartment = (departmentAliases[user.department] ?? user.department) as Document['department']
  return Array.from(new Set([ownDepartment, 'Policies'])) as Document['department'][]
}

export const departmentLoginRoles: Array<{ department: string; roles: Role[] }> = [
  { department: 'HR', roles: ['hr'] },
  { department: 'IT / Engineering', roles: ['manager', 'employee'] },
  { department: 'Finance / Sales', roles: ['employee'] },
  { department: 'Legal', roles: ['admin'] },
]

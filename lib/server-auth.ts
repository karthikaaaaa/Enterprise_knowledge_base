import { getUserByEmail, getRoleById, getEmployeeByUserId, type User, type Role, type Employee } from '@/lib/workflow-store'

export type Caller = { user: User; role: Role; employee: Employee | null }

/**
 * There's no server session in this app (the demo login lives in sessionStorage on the
 * client — see components/auth/auth-provider.tsx). The client identifies itself with an
 * `x-user-email` header, which we resolve against the seeded `users` table to get a real
 * role/department to authorize against, rather than trusting a client-supplied role.
 */
export function getCaller(request: Request): Caller | null {
  const email = request.headers.get('x-user-email')
  if (!email) return null
  const user = getUserByEmail(email)
  // Deactivated accounts (e.g. an employee whose offboarding is complete) get no access anywhere.
  if (!user || !user.isActive) return null
  const role = getRoleById(user.roleId)
  if (!role) return null
  const employee = getEmployeeByUserId(user.id)
  return { user, role, employee }
}

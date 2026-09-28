import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { listTasksForRole } from '@/lib/task-view'

const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

export async function GET(request: Request) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!DEPARTMENT_ROLES.has(caller.role.name)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ tasks: listTasksForRole(caller.role.name) })
}

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflowDetail } from '@/lib/workflow-view'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const detail = getWorkflowDetail(id)
  if (!detail) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const roleName = caller.role.name
  const authorized =
    roleName === 'HR' ||
    roleName === 'Administrator' ||
    (roleName === 'Manager' && !!caller.user.departmentId && detail.employee.departmentId === caller.user.departmentId) ||
    (roleName === 'Employee' && !!caller.employee && detail.employee.id === caller.employee.id)

  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(detail)
}

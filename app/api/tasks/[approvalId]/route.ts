import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getTaskOwnership } from '@/lib/task-view'
import { setApprovalStatusDirect, type TaskActionError } from '@/lib/task-actions'

const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

const ERROR_STATUS: Record<TaskActionError, number> = {
  approval_not_found: 404,
  subtask_not_found: 404,
  approval_locked: 409,
  has_subtasks: 400,
}

/** Fallback for ad-hoc tasks with no subtasks — a direct "Mark Complete" toggle. Tasks with subtasks must go through the subtask endpoint. */
export async function PATCH(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!DEPARTMENT_ROLES.has(caller.role.name)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { approvalId } = await params
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  if (ownership.step.departmentName !== caller.role.name) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const status = body?.status
  if (status !== 'completed' && status !== 'allocated') {
    return NextResponse.json({ error: "status must be 'completed' or 'allocated'" }, { status: 400 })
  }

  const result = setApprovalStatusDirect(approvalId, status)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ approvalStatus: result.approvalStatus })
}

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getTaskOwnership } from '@/lib/task-view'
import { generateItAccountCredentials, type ItAccountReportError } from '@/lib/task-actions'

const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

const ERROR_STATUS: Record<ItAccountReportError, number> = {
  approval_not_found: 404,
  wrong_step: 400,
  approval_locked: 409,
  subtask_not_found: 404,
  not_ready: 400,
}

/** Compiles the it_account_creation account/access summary (email + temporary password) and
 * completes the "Review" checklist item — approving is a separate step (see the it-approve
 * route). Not hardcoded to a single role — it_account_creation's owning department has changed
 * more than once, so this checks the caller is SOME department-worker role, then the ownership
 * check below does the real per-step authorization. The employee doesn't see the result until HR
 * also verifies the whole step (see the dual-gated report route). */
export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
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

  const result = await generateItAccountCredentials(approvalId, caller.user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ approvalStatus: result.approvalStatus, subtasks: result.subtasks, report: result.report })
}

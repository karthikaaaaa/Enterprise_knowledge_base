import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getTaskOwnership } from '@/lib/task-view'
import { sendBackDepartmentReview, type SendBackError } from '@/lib/task-actions'

const ERROR_STATUS: Record<SendBackError, number> = {
  approval_not_found: 404,
  wrong_step: 400,
  approval_locked: 409,
  not_ready: 400,
  comment_required: 400,
  rerun_required: 409,
}

/** "Send back" on a structured AI review (finance_verification today): the owning department head
 * returns the latest run to HR with a required comment instead of verifying it. Same ownership rule
 * as department-verify — the step's department must be the caller's role. */
export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { approvalId } = await params
  const ownership = getTaskOwnership(approvalId)
  if (!ownership) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  if (ownership.step.departmentName !== caller.role.name) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { comment?: unknown } | null
  const result = sendBackDepartmentReview(approvalId, caller.user.id, typeof body?.comment === 'string' ? body.comment : '')
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ runId: result.runId })
}

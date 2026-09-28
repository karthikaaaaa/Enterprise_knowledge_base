import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getTaskOwnership } from '@/lib/task-view'
import { approveItVerification, type SimpleApprovalError } from '@/lib/task-actions'

const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

const ERROR_STATUS: Record<SimpleApprovalError, number> = {
  approval_not_found: 404,
  wrong_step: 400,
  approval_locked: 409,
  not_ready: 400,
}

/** Confirms the AI-generated IT sign-off summary (see the it_verification/summary route) and moves
 * the approval straight to 'completed' — no subtask checklist, just this one button. Refuses if
 * the summary hasn't been generated yet, which also covers "preconditions not met yet" since the
 * summary only ever exists once it_account_creation AND asset_allocation are both verified (see
 * approveItVerification / maybeGenerateItVerificationSummary). Not hardcoded to a single role; see
 * it-approve route's comment for why. */
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

  const result = approveItVerification(approvalId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ approvalStatus: result.approvalStatus })
}

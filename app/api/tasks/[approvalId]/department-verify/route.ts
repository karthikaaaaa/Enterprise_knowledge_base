import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getTaskOwnership } from '@/lib/task-view'
import { verifyDepartmentSummaryStep, type DepartmentVerifyError } from '@/lib/task-actions'

const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

const ERROR_STATUS: Record<DepartmentVerifyError, number> = {
  approval_not_found: 404,
  wrong_step: 400,
  approval_locked: 409,
  not_ready: 400,
  review_required: 400,
  rerun_required: 409,
}

/** The department head's "Verify" on their own Tasks card for finance_verification (Fatima) or
 * legal_verification (Lucas): confirms the AI pre-check summary (see the
 * finance_verification/legal_verification summary routes) and moves the approval to 'completed' —
 * NOT 'verified'. HR's separate Verify on the combined timeline (steps/[stepId]/verify) is still
 * required after this, exactly like every other department step. Refuses if the summary hasn't
 * been generated yet. The ownership check below (step's department === caller's role) keeps
 * Finance and Legal from completing each other's step. */
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

  // Optional body — legal_verification sends none. finance_verification's flagged runs need
  // { acknowledged: true, comment } (see verifyDepartmentSummaryStep).
  const body = (await request.json().catch(() => null)) as { acknowledged?: unknown; comment?: unknown } | null
  const result = verifyDepartmentSummaryStep(approvalId, caller.user.id, {
    acknowledged: body?.acknowledged === true,
    comment: typeof body?.comment === 'string' ? body.comment : null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ approvalStatus: result.approvalStatus })
}

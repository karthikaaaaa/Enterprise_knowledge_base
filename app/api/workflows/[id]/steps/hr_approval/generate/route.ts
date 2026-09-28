import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { generateHrApprovalProfileEntry, type WorkflowActionError } from '@/lib/workflow-actions'

const ERROR_STATUS: Record<WorkflowActionError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_department_fixed: 400,
  already_notified: 409,
  department_role_missing: 400,
  invalid_anchor_step: 400,
  not_completed: 400,
  already_verified: 409,
  step_locked: 409,
  already_submitted: 409,
}

const ERROR_MESSAGE: Record<WorkflowActionError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'Step not found on this workflow',
  not_department_fixed: 'This step is not owned by IT, Finance, or Legal',
  already_notified: 'This step has already been notified',
  department_role_missing: 'No role is configured for this department',
  invalid_anchor_step: 'Invalid step to insert after',
  not_completed: 'Employee details must be submitted before a profile can be generated',
  already_verified: 'This step has already been verified',
  step_locked: 'Complete and verify the previous step before starting this one',
  already_submitted: 'This step has already been verified and can no longer be re-run',
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'HR' && caller.role.name !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const result = await generateHrApprovalProfileEntry(id, caller.user.id)
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ step: result.step, entry: result.entry })
}

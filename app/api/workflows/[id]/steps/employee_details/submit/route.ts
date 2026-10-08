import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { submitEmployeeDetails, type WorkflowActionError } from '@/lib/workflow-actions'

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
  precondition_not_met: 400,
  already_granted: 409,
}

const ERROR_MESSAGE: Record<WorkflowActionError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'Step not found on this workflow',
  not_department_fixed: 'This step is not owned by IT, Finance, or Legal',
  already_notified: 'This step has already been notified',
  department_role_missing: 'No role is configured for this department',
  invalid_anchor_step: 'Invalid step to insert after',
  not_completed: "Only a step with status 'completed' can be verified",
  already_verified: 'This step has already been verified',
  step_locked: 'Complete and verify the previous step before starting this one',
  already_submitted: 'Employee details have already been verified and can no longer be edited',
  precondition_not_met: 'Legal Verification must be verified before Knowledge Base access can be granted',
  already_granted: 'Knowledge Base access has already been granted',
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'Employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!caller.employee || caller.employee.id !== workflow.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const address = typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null
  const roleTitle = typeof body?.role_title === 'string' ? body.role_title.trim() : ''
  const department = typeof body?.department === 'string' ? body.department.trim() : ''
  const startDate = typeof body?.start_date === 'string' ? body.start_date.trim() : ''

  if (!fullName || !email || !phone || !roleTitle || !department || !startDate) {
    return NextResponse.json(
      { error: 'full_name, email, phone, role_title, department, and start_date are required' },
      { status: 400 },
    )
  }

  const result = submitEmployeeDetails(id, caller.user.id, { fullName, email, phone, address, roleTitle, department, startDate })
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ step: result.step })
}

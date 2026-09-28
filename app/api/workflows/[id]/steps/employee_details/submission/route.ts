import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getEmployeeDetailSubmissionByWorkflow } from '@/lib/workflow-store'

/** Generic read of step 1's submitted form data — powers HR's "View Details" panel today and,
 * later, the AI document cross-check, so it stays a plain data endpoint rather than baking the
 * fields into the submit response only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const roleName = caller.role.name
  const authorized =
    roleName === 'HR' ||
    roleName === 'Administrator' ||
    (roleName === 'Employee' && !!caller.employee && caller.employee.id === workflow.employeeId)

  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const submission = getEmployeeDetailSubmissionByWorkflow(id)
  if (!submission) {
    return NextResponse.json({ error: 'Employee details have not been submitted yet' }, { status: 404 })
  }

  return NextResponse.json({ submission })
}

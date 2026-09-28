import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestManagerApprovalReport } from '@/lib/workflow-store'

const CAN_MANAGE_ROLES = new Set(['Administrator', 'HR'])
// Whichever department currently owns manager_approval (this has changed more than once) should
// be able to see the report it generated — not hardcoded to a single role, same reasoning as the
// generate/approve routes.
const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

/** Unlike hr_approval's entry (HR-only), this report is meant to be seen by HR, the owning
 * department (who generated it), and the employee themselves once it exists — "reflect completed
 * on both the hr and employee login" per the request that added this. */
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

  const isOwner = !!caller.employee && caller.employee.id === workflow.employeeId
  const canView = CAN_MANAGE_ROLES.has(caller.role.name) || DEPARTMENT_ROLES.has(caller.role.name) || isOwner
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const report = getLatestManagerApprovalReport(id)
  if (!report) {
    return NextResponse.json({ error: 'Report has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ report })
}

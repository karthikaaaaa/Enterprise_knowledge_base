import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestItVerificationSummary } from '@/lib/workflow-store'

const CAN_MANAGE_ROLES = new Set(['Administrator', 'HR'])
// Whichever department currently owns it_verification (Manager/Diego) should be able to see the
// summary it's reviewing — not hardcoded to a single role, same reasoning as manager_approval's
// report route.
const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

/** Same visibility as asset_allocation's summary route: HR, the owning department (reviewing it),
 * and the employee themselves once it exists. A 404 here also covers "preconditions not met yet"
 * (the summary only exists once it_account_creation AND asset_allocation are both verified) —
 * callers show a waiting state rather than treating that as an error. */
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

  const summary = getLatestItVerificationSummary(id)
  if (!summary) {
    return NextResponse.json({ error: 'Summary has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ summary })
}

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestAssetAllocationSummary } from '@/lib/workflow-store'

const CAN_MANAGE_ROLES = new Set(['Administrator', 'HR'])
// Whichever department currently owns asset_allocation (Manager/Diego) should be able to see the
// summary it's reviewing — not hardcoded to a single role, same reasoning as manager_approval's
// report route.
const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

/** Same visibility as manager_approval's report: HR, the owning department (reviewing it), and the
 * employee themselves once it exists — nothing sensitive here (just which physical assets are
 * being handed over), unlike it_account_creation's dual-gated credentials. */
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

  const summary = getLatestAssetAllocationSummary(id)
  if (!summary) {
    return NextResponse.json({ error: 'Summary has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ summary })
}

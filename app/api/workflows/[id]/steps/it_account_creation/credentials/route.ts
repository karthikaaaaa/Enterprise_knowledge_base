import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestItAccountReport } from '@/lib/workflow-store'
import { listWorkflowStepDetails } from '@/lib/workflow-view'

const CAN_MANAGE_ROLES = new Set(['Administrator', 'HR'])

/** Dual-gated, unlike hr_approval's entry and manager_approval's report: HR/Admin/Manager (Diego,
 * who now owns it_account_creation) can see this as soon as it's generated (step 'completed'), so
 * HR has something to verify — but the employee only ever sees it once HR has ALSO verified the
 * whole step, per the request that added this ("the credentials to be sent to the employee login
 * after the hr also verifies"). */
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
  const isManager = CAN_MANAGE_ROLES.has(caller.role.name) || caller.role.name === 'Manager'
  if (!isOwner && !isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const step = listWorkflowStepDetails(id).find((s) => s.stepName === 'it_account_creation')
  if (!step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  }

  const status = step.approval?.status
  const readyForManager = status === 'completed' || status === 'verified'
  const readyForEmployee = status === 'verified'
  const canView = (isManager && readyForManager) || (isOwner && readyForEmployee)
  if (!canView) {
    return NextResponse.json({ error: 'Not available yet' }, { status: 403 })
  }

  const report = getLatestItAccountReport(id)
  if (!report) {
    return NextResponse.json({ error: 'Credentials summary has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ report })
}

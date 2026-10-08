import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, getLatestStepAiSummary, type StepAiSummaryKey } from '@/lib/workflow-store'

const CAN_MANAGE_ROLES = new Set(['Administrator', 'HR'])
// Whichever department currently owns the step should be able to see the summary it's reviewing —
// not hardcoded to a single role, same reasoning as manager_approval's report route.
const DEPARTMENT_ROLES = new Set(['IT', 'Finance', 'Legal', 'Manager'])

/** Shared GET handler behind every AI-summary step's `/summary` route (asset_allocation,
 * it_verification, finance_verification, legal_verification). Same visibility as
 * manager_approval's report: HR, the owning department (reviewing it), and the employee themselves
 * once it exists. A 404 means "not generated yet" — callers show a waiting state rather than
 * treating that as an error (for it_verification it also covers "preconditions not met yet"). */
export async function getStepSummaryResponse(request: Request, workflowId: string, stepKey: StepAiSummaryKey) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const isOwner = !!caller.employee && caller.employee.id === workflow.employeeId
  const canView = CAN_MANAGE_ROLES.has(caller.role.name) || DEPARTMENT_ROLES.has(caller.role.name) || isOwner
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const summary = getLatestStepAiSummary(workflowId, stepKey)
  if (!summary) {
    return NextResponse.json({ error: 'Summary has not been generated yet' }, { status: 404 })
  }

  return NextResponse.json({ summary })
}

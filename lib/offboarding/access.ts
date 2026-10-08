import { getEmployeeByUserId, getWorkflowSteps, listApprovalsByWorkflow, listWorkflowsByEmployee, type Workflow } from '@/lib/workflow-store'
import { hasActiveKbRestriction } from '@/lib/offboarding/store'
import { HANDOVER_CATEGORIES } from '@/lib/offboarding/context'

/**
 * What an employee being offboarded may still reach. Enforced server-side:
 *   - getCaller (lib/server-auth.ts) rejects deactivated users, so after Exit Completed every API
 *     refuses them;
 *   - resolveKbAccess (lib/kb-access.ts) narrows the Knowledge Base — and so AI Chat, which uses the
 *     same access — to the handover categories once IT Access Deactivation has run.
 */

export type OffboardingStatus = 'exiting' | 'exited' | null

/** An offboarding only counts once Exit Initiated has been started (HR recorded the exit). Reverting
 * Exit Initiated takes it back to "not initiated", so the employee is Active again. */
export function isExitInitiated(workflow: Workflow): boolean {
  if (workflow.status === 'completed') return true
  const step = getWorkflowSteps(workflow.id).find((s) => s.stepName === 'exit_initiated')
  if (!step) return true
  return listApprovalsByWorkflow(workflow.id).some((a) => a.stepId === step.id)
}

function initiatedOffboardings(employeeId: string) {
  return listWorkflowsByEmployee(employeeId).filter((w) => w.type === 'offboarding' && isExitInitiated(w))
}

export function offboardingStatusForUser(userId: string): OffboardingStatus {
  const employee = getEmployeeByUserId(userId)
  if (!employee) return null
  const offboarding = initiatedOffboardings(employee.id)
  if (offboarding.length === 0) return null
  return offboarding.some((w) => w.status !== 'completed') ? 'exiting' : 'exited'
}

/** Knowledge Base categories an exiting employee keeps, or null when no offboarding restriction applies. */
export function offboardingKbCategories(employeeId: string): string[] | null {
  const offboarding = initiatedOffboardings(employeeId)
  if (offboarding.length === 0) return null
  if (offboarding.every((w) => w.status === 'completed')) return []
  return hasActiveKbRestriction(offboarding.map((w) => w.id)) ? [...HANDOVER_CATEGORIES] : null
}

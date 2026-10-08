import {
  getWorkflow,
  getWorkflowSteps,
  getEmployeeById,
  getEmployeeByUserId,
  getUserById,
  getDepartmentById,
  getRoleByName,
  listUsersByRole,
  createEmployee,
  type Approval,
  type Employee,
  type User,
  type Workflow,
  type WorkflowStep,
} from '@/lib/workflow-store'
import { getLatestApprovalForStep } from '@/lib/workflow-view'
import { ensureExitDetails, setEmployeeManager, type ExitDetails } from '@/lib/offboarding/store'

/** Shared lookups every offboarding step needs. Generic for any offboarding workflow. */

export const OFFBOARDING_STEPS = [
  'exit_initiated',
  'manager_exit_approval',
  'hr_exit_approval',
  'knowledge_transfer',
  'it_access_deactivation',
  'asset_recovery',
  'finance_settlement',
  'legal_clearance',
  'exit_completed',
] as const
export type OffboardingStepKey = (typeof OFFBOARDING_STEPS)[number]

/** Knowledge Base categories an exiting employee keeps for handover once IT Access Deactivation
 * has removed department/sensitive ones. */
export const HANDOVER_CATEGORIES = ['Policies']

export type OffboardingContext = {
  workflow: Workflow
  employee: Employee
  user: User | null
  name: string
  department: string | null
  steps: WorkflowStep[]
}

export function loadOffboarding(workflowId: string): OffboardingContext | null {
  const workflow = getWorkflow(workflowId)
  if (!workflow || workflow.type !== 'offboarding') return null
  const employee = getEmployeeById(workflow.employeeId)
  if (!employee) return null
  const department = employee.departmentId ? getDepartmentById(employee.departmentId) : null
  return {
    workflow,
    employee,
    user: getUserById(employee.userId),
    name: `${employee.firstName} ${employee.lastName}`,
    department: department?.name ?? null,
    steps: getWorkflowSteps(workflowId),
  }
}

export function stepOf(ctx: OffboardingContext, key: OffboardingStepKey): WorkflowStep | null {
  return ctx.steps.find((s) => s.stepName === key) ?? null
}

export function approvalOf(ctx: OffboardingContext, key: OffboardingStepKey): Approval | null {
  const step = stepOf(ctx, key)
  return step ? getLatestApprovalForStep(ctx.workflow.id, step.id) : null
}

/** Exit details, backfilled once from the employee record (date_of_leaving) for workflows that
 * started before exit details were captured — exit type is then "not recorded" until HR sets it. */
export function exitDetailsFor(ctx: OffboardingContext): ExitDetails {
  return ensureExitDetails({ workflowId: ctx.workflow.id, lastWorkingDay: ctx.employee.dateOfLeaving })
}

/** Whole days of notice given (notice start date → last working day); null if either is unknown. */
export function noticePeriodDays(_ctx: OffboardingContext, details: ExitDetails): number | null {
  if (!details.lastWorkingDay || !details.noticeStartDate) return null
  const start = Date.parse(details.noticeStartDate)
  const end = Date.parse(details.lastWorkingDay)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 86_400_000)
}

// ---------- Reporting manager ----------

/** The reporting manager's user account, from employees.manager_id → their employee → user. */
export function resolveManagerUser(ctx: OffboardingContext): User | null {
  const managerEmployee = ctx.employee.managerId ? getEmployeeById(ctx.employee.managerId) : null
  return managerEmployee ? getUserById(managerEmployee.userId) : null
}

/** Users HR can pick as the reporting manager when none is set. */
export function listManagerCandidates(): User[] {
  const role = getRoleByName('Manager')
  return role ? listUsersByRole(role.id) : []
}

/** Saves `managerUserId` as the employee's reporting manager (employees.manager_id points at an
 * employee row, so a manager without one gets a minimal employee record first). */
export function assignManager(ctx: OffboardingContext, managerUserId: string): User | null {
  const managerUser = listManagerCandidates().find((u) => u.id === managerUserId)
  if (!managerUser) return null
  let managerEmployee = getEmployeeByUserId(managerUser.id)
  if (!managerEmployee) {
    const [firstName, ...rest] = managerUser.name.split(' ')
    managerEmployee = createEmployee({
      userId: managerUser.id,
      empCode: `EMP-${managerUser.id.slice(-8).toUpperCase()}`,
      firstName: firstName || managerUser.name,
      lastName: rest.join(' ') || '-',
      departmentId: managerUser.departmentId,
    })
  }
  setEmployeeManager(ctx.employee.id, managerEmployee.id)
  ctx.employee = { ...ctx.employee, managerId: managerEmployee.id }
  return managerUser
}

/** First user with the department's role — same rule onboarding's Notify uses. */
export function departmentHead(departmentName: string): User | null {
  const role = getRoleByName(departmentName)
  return role ? (listUsersByRole(role.id)[0] ?? null) : null
}

export function utcStamp(iso: string) {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

import {
  listAllWorkflows,
  getWorkflowSteps,
  listApprovalsByWorkflow,
  listSubtasksByApproval,
  getEmployeeById,
  getUserById,
  getRoleById,
  getApproval,
  getWorkflowStepById,
  type Approval,
  type WorkflowStep,
} from '@/lib/workflow-store'
import { humanizeStepName } from '@/lib/workflow-format'

/** Notified but not yet HR-verified — these are the statuses a department's Tasks queue should surface. */
const TASK_STATUSES = new Set(['allocated', 'in_progress', 'completed'])

export type TaskItem = {
  approvalId: string
  workflowId: string
  /** 'onboarding' | 'offboarding' — the Tasks page labels offboarding tasks. */
  workflowType: string
  stepId: string
  stepName: string
  stepTitle: string
  stepDescription: string | null
  departmentName: string
  status: string
  createdAt: string
  isAdhoc: boolean
  employee: { id: string; name: string; role: string }
  subtasks: { completed: number; total: number }
}

function describeEmployeeBasic(employeeId: string): TaskItem['employee'] | null {
  const employee = getEmployeeById(employeeId)
  if (!employee) return null
  const user = getUserById(employee.userId)
  const role = user ? getRoleById(user.roleId) : null
  return { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, role: role?.name ?? 'Employee' }
}

/** All approvals owned by `roleName` (IT/Finance/Legal/Manager) that haven't reached HR verification yet, sorted by employee then age. */
export function listTasksForRole(roleName: string): TaskItem[] {
  const tasks: TaskItem[] = []

  for (const workflow of listAllWorkflows()) {
    const steps = getWorkflowSteps(workflow.id)
    const latestByStep = new Map<string, Approval>()
    for (const approval of listApprovalsByWorkflow(workflow.id)) latestByStep.set(approval.stepId, approval)

    for (const step of steps) {
      if (step.departmentName !== roleName) continue
      const approval = latestByStep.get(step.id)
      if (!approval || !TASK_STATUSES.has(approval.status)) continue

      const employee = describeEmployeeBasic(workflow.employeeId)
      if (!employee) continue

      const subtasks = listSubtasksByApproval(approval.id)
      tasks.push({
        approvalId: approval.id,
        workflowId: workflow.id,
        workflowType: workflow.type,
        stepId: step.id,
        stepName: step.stepName,
        stepTitle: humanizeStepName(step.stepName),
        stepDescription: step.description,
        departmentName: step.departmentName,
        status: approval.status,
        createdAt: approval.createdAt,
        isAdhoc: step.isAdhoc,
        employee,
        subtasks: { completed: subtasks.filter((s) => s.status === 'completed').length, total: subtasks.length },
      })
    }
  }

  return tasks.sort((a, b) => a.employee.name.localeCompare(b.employee.name) || a.createdAt.localeCompare(b.createdAt))
}

/** Resolves an approval's owning step, for the ownership check every task route needs (approval id alone isn't enough — a Finance user could guess an IT approval's id). */
export function getTaskOwnership(approvalId: string): { approval: Approval; step: WorkflowStep } | null {
  const approval = getApproval(approvalId)
  if (!approval) return null
  const step = getWorkflowStepById(approval.stepId)
  if (!step) return null
  return { approval, step }
}

import {
  listAllWorkflows,
  getWorkflow,
  getWorkflowSteps,
  listApprovalsByWorkflow,
  getEmployeeById,
  getUserById,
  getDepartmentById,
  getRoleById,
  type Workflow,
  type Approval,
} from '@/lib/workflow-store'

export type WorkflowEmployee = {
  id: string
  name: string
  role: string
  departmentId: string | null
  department: string | null
  dateOfJoining: string | null
}

export type WorkflowProgress = { verified: number; total: number; percent: number }

export type WorkflowSummary = {
  id: string
  type: string
  status: string
  createdAt: string
  employee: WorkflowEmployee
  progress: WorkflowProgress
  currentStep: { id: string; stepName: string; departmentName: string } | null
  /** Steps whose department finished (approval status='completed') but HR hasn't verified yet. */
  pendingVerificationCount: number
}

export type WorkflowStepDetail = {
  id: string
  order: number
  stepName: string
  departmentName: string
  description: string | null
  isAdhoc: boolean
  approval: { status: string; comment: string | null; verifiedAt: string | null } | null
  /** True until every earlier step in the ordered list has been verified — steps run strictly top to bottom. */
  locked: boolean
}

export type WorkflowDetail = {
  id: string
  type: string
  status: string
  createdAt: string
  updatedAt: string
  employee: WorkflowEmployee
  progress: WorkflowProgress
  steps: WorkflowStepDetail[]
}

function describeEmployee(employeeId: string): WorkflowEmployee | null {
  const employee = getEmployeeById(employeeId)
  if (!employee) return null
  const user = getUserById(employee.userId)
  const role = user ? getRoleById(user.roleId) : null
  const department = employee.departmentId ? getDepartmentById(employee.departmentId) : null
  return {
    id: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    role: role?.name ?? 'Employee',
    departmentId: employee.departmentId,
    department: department?.name ?? null,
    dateOfJoining: employee.dateOfJoining,
  }
}

/** Approvals accumulate over time (re-notify, re-verify); the most recently created row per step wins. */
function latestApprovalByStep(workflowId: string): Map<string, Approval> {
  const approvals = listApprovalsByWorkflow(workflowId)
  const byStep = new Map<string, Approval>()
  for (const approval of approvals) byStep.set(approval.stepId, approval)
  return byStep
}

function computeProgress(workflowId: string) {
  const steps = getWorkflowSteps(workflowId)
  const latest = latestApprovalByStep(workflowId)
  const verified = steps.filter((step) => latest.get(step.id)?.status === 'verified').length
  const total = steps.length
  const percent = total === 0 ? 0 : Math.round((verified / total) * 100)
  return { verified, total, percent, steps, latest }
}

export function buildWorkflowSummary(workflow: Workflow): WorkflowSummary | null {
  const employee = describeEmployee(workflow.employeeId)
  if (!employee) return null
  const { verified, total, percent, steps, latest } = computeProgress(workflow.id)
  const currentStep = workflow.currentStepId ? (steps.find((step) => step.id === workflow.currentStepId) ?? null) : null
  const pendingVerificationCount = steps.filter((step) => latest.get(step.id)?.status === 'completed').length
  return {
    id: workflow.id,
    type: workflow.type,
    status: workflow.status,
    createdAt: workflow.createdAt,
    employee,
    progress: { verified, total, percent },
    currentStep: currentStep
      ? { id: currentStep.id, stepName: currentStep.stepName, departmentName: currentStep.departmentName }
      : null,
    pendingVerificationCount,
  }
}

export function listWorkflowSummaries(filter?: { employeeId?: string; departmentId?: string }): WorkflowSummary[] {
  const summaries: WorkflowSummary[] = []
  for (const workflow of listAllWorkflows()) {
    if (filter?.employeeId && workflow.employeeId !== filter.employeeId) continue
    if (filter?.departmentId) {
      const employee = getEmployeeById(workflow.employeeId)
      if (employee?.departmentId !== filter.departmentId) continue
    }
    const summary = buildWorkflowSummary(workflow)
    if (summary) summaries.push(summary)
  }
  return summaries
}

/** The workflow's full ordered step list, each joined with its latest approval — the shape both GET /api/workflows/[id] and the write endpoints (notify, ad-hoc insert) return. */
export function listWorkflowStepDetails(workflowId: string): WorkflowStepDetail[] {
  const { steps, latest } = computeProgress(workflowId)
  return steps.map((step, index) => {
    const approval = latest.get(step.id) ?? null
    const previousStep = index > 0 ? steps[index - 1] : null
    const locked = previousStep ? latest.get(previousStep.id)?.status !== 'verified' : false
    return {
      id: step.id,
      order: index + 1,
      stepName: step.stepName,
      departmentName: step.departmentName,
      description: step.description,
      isAdhoc: step.isAdhoc,
      approval: approval ? { status: approval.status, comment: approval.comment, verifiedAt: approval.verifiedAt } : null,
      locked,
    }
  })
}

export function getWorkflowStepDetail(workflowId: string, stepId: string): WorkflowStepDetail | null {
  return listWorkflowStepDetails(workflowId).find((step) => step.id === stepId) ?? null
}

/** The steps whose department finished their work but HR hasn't signed off on yet. */
export function listPendingVerificationSteps(workflowId: string): WorkflowStepDetail[] {
  return listWorkflowStepDetails(workflowId).filter((step) => step.approval?.status === 'completed')
}

/** The raw approval row behind a step's summarized `.approval` field — needed to actually mutate it (verify, etc). */
export function getLatestApprovalForStep(workflowId: string, stepId: string): Approval | null {
  let latest: Approval | null = null
  for (const approval of listApprovalsByWorkflow(workflowId)) {
    if (approval.stepId === stepId) latest = approval
  }
  return latest
}

export function getWorkflowDetail(workflowId: string): WorkflowDetail | null {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return null
  const employee = describeEmployee(workflow.employeeId)
  if (!employee) return null

  const { verified, total, percent } = computeProgress(workflowId)

  return {
    id: workflow.id,
    type: workflow.type,
    status: workflow.status,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    employee,
    progress: { verified, total, percent },
    steps: listWorkflowStepDetails(workflowId),
  }
}

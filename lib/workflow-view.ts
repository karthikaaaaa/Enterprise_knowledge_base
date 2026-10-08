import {
  listAllWorkflows,
  getWorkflow,
  getWorkflowSteps,
  listApprovalsByWorkflow,
  getEmployeeById,
  getUserById,
  getDepartmentById,
  getRoleById,
  getRoleByName,
  listUsersByRole,
  type Workflow,
  type Approval,
  type User,
  type WorkflowStep,
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

/** "In charge" chip shown on every step card — a real name/role, never a bare department string. */
export type StepPerson = { name: string; role: string; initials: string }

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
  /** Who owns this step right now — the real approver once notified/submitted, otherwise a
   * resolved default (the employee, "AI System", or the owning department's head). Always present. */
  inCharge: StepPerson
  /** When this step was assigned/notified (the approval row's created_at) — null until then. */
  assignedAt: string | null
  completedBy: StepPerson | null
  completedAt: string | null
  verifiedBy: StepPerson | null
  verifiedAt: string | null
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

/** Friendlier label than the bare Role.name for the people-facing "in charge" chip — HR and
 * Manager already read fine standalone, but a lone "IT"/"Finance"/"Legal" reads as a department,
 * not a person's role, next to a name. */
const ROLE_DISPLAY_LABEL: Record<string, string> = {
  HR: 'HR',
  IT: 'IT Head',
  Finance: 'Finance Head',
  Legal: 'Legal Head',
  Manager: 'Manager',
  Administrator: 'Administrator',
  Employee: 'Employee',
}

function initialsOf(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return parts.map((p) => p[0]!.toUpperCase()).slice(0, 2).join('') || '?'
}

function personFromUser(user: User): StepPerson {
  const role = getRoleById(user.roleId)
  return { name: user.name, role: role ? (ROLE_DISPLAY_LABEL[role.name] ?? role.name) : 'Staff', initials: initialsOf(user.name) }
}

function personFromUserId(userId: string | null): StepPerson | null {
  if (!userId) return null
  const user = getUserById(userId)
  return user ? personFromUser(user) : null
}

/** The department's one head user — same "first user with this role" resolution
 * resolveDepartmentApprover in lib/workflow-actions.ts uses, duplicated here rather than imported
 * to avoid a circular import (workflow-actions.ts already imports from this module). */
function departmentHeadUser(departmentName: string): User | null {
  const role = getRoleByName(departmentName)
  if (!role) return null
  return listUsersByRole(role.id)[0] ?? null
}

/**
 * Resolves who's "in charge" of a step:
 *   1. If it's already been notified/submitted (an approval row with an approver_id exists), that's them.
 *   2. employee_details / upload_documents: the employee themself.
 *   3. ai_document_verification: the synthetic "AI System" — there's no real user behind this step.
 *   4. Everything else (hr_approval, knowledge_base_access, completed, manager_approval,
 *      it_account_creation, asset_allocation, it_verification, finance_verification,
 *      legal_verification, and any ad-hoc step) — the head of the step's owning department,
 *      which is exactly who Notify would assign it to (see resolveDepartmentApprover).
 */
function resolveInCharge(step: WorkflowStep, workflow: Workflow, approval: Approval | null): StepPerson {
  if (approval?.approverId) {
    const person = personFromUserId(approval.approverId)
    if (person) return person
  }

  if (step.stepName === 'employee_details' || step.stepName === 'upload_documents') {
    const employee = getEmployeeById(workflow.employeeId)
    const user = employee ? getUserById(employee.userId) : null
    if (user) return personFromUser(user)
    const name = employee ? `${employee.firstName} ${employee.lastName}` : 'Employee'
    return { name, role: 'Employee', initials: initialsOf(name) }
  }

  if (step.stepName === 'ai_document_verification') {
    return { name: 'AI System', role: 'Automated', initials: 'AI' }
  }

  const head = departmentHeadUser(step.departmentName)
  if (head) return personFromUser(head)
  return { name: 'Unassigned', role: step.departmentName, initials: '?' }
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
  const workflow = getWorkflow(workflowId)
  if (!workflow) return []
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
      inCharge: resolveInCharge(step, workflow, approval),
      assignedAt: approval?.createdAt ?? null,
      completedBy: personFromUserId(approval?.completedBy ?? null),
      completedAt: approval?.completedAt ?? null,
      verifiedBy: personFromUserId(approval?.verifiedBy ?? null),
      verifiedAt: approval?.verifiedAt ?? null,
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

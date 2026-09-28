// Seeds storage/workflows.db with roles, departments, users, the onboarding and
// offboarding templates + their steps and subtask checklists, and three sample
// workflows (Elena Petrova onboarding, Mei Tanaka offboarding, James Okoro onboarding —
// James exists purely to give Manager-scoped access a real positive case to test against).
// Safe to re-run: every insert is guarded by a lookup for an existing row first.
import crypto from 'node:crypto'
import {
  getOrCreateRole,
  getOrCreateDepartment,
  getUserByEmail,
  createUser,
  getEmployeeByUserId,
  createEmployee,
  getWorkflowTemplateByType,
  createWorkflowTemplate,
  listTemplateSteps,
  createTemplateStep,
  listSubtaskTemplatesByStep,
  createSubtaskTemplate,
  listWorkflowsByEmployee,
  createWorkflow,
  createApproval,
  getWorkflowSteps,
  listApprovalsByWorkflow,
  type Role,
  type Department,
  type User,
  type WorkflowStep,
  type WorkflowType,
} from '../lib/workflow-store.ts'

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

const ROLE_NAMES = ['HR', 'Employee', 'IT', 'Finance', 'Legal', 'Manager', 'Administrator']

const DEPARTMENT_NAMES = ['People Operations', 'Engineering', 'Finance', 'Legal', 'Product', 'Sales', 'Operations', 'IT']

// Mirrors components/auth/auth-provider.tsx DEMO_USERS, mapped onto the new roles/departments tables.
const EXISTING_DEMO_USERS = [
  { name: 'Amara Okafor', email: 'amara@knowledgeos.demo', password: 'Admin123!', role: 'Administrator', department: 'Operations' },
  { name: 'Priya Nair', email: 'priya@knowledgeos.demo', password: 'HR123456!', role: 'HR', department: 'People Operations' },
  { name: 'Diego Ramirez', email: 'diego@knowledgeos.demo', password: 'Manager123!', role: 'Manager', department: 'Engineering' },
  { name: 'Fatima Ali', email: 'fatima@knowledgeos.demo', password: 'Finance123!', role: 'Finance', department: 'Finance' },
  { name: 'Lucas Meyer', email: 'lucas@knowledgeos.demo', password: 'Legal123!', role: 'Legal', department: 'Legal' },
  { name: 'Elena Petrova', email: 'elena@knowledgeos.demo', password: 'Employee123!', role: 'Employee', department: 'Product' },
  { name: 'James Okoro', email: 'james@knowledgeos.demo', password: 'Employee123!', role: 'Employee', department: 'Engineering' },
  { name: 'Mei Tanaka', email: 'mei@knowledgeos.demo', password: 'Employee123!', role: 'Employee', department: 'Sales' },
]

// New approvers this step's workflow needs. Same shape/style as the existing demo users
// above, but not wired into the client-side login switcher yet — data-layer only for now.
const NEW_DEMO_USERS = [
  { name: 'Rahul Mehta', email: 'rahul@knowledgeos.demo', password: 'ITHead123!', role: 'IT', department: 'IT' },
  { name: 'Sofia Rossi', email: 'sofia@knowledgeos.demo', password: 'FinanceHead123!', role: 'Finance', department: 'Finance' },
  { name: 'Noah Bennett', email: 'noah@knowledgeos.demo', password: 'LegalHead123!', role: 'Legal', department: 'Legal' },
]

const ONBOARDING_TEMPLATE_STEPS = [
  { stepName: 'employee_details', departmentName: 'HR', description: 'Personal and role information collected' },
  { stepName: 'upload_documents', departmentName: 'HR', description: 'ID, tax forms, and certifications submitted' },
  { stepName: 'ai_document_verification', departmentName: 'HR', description: 'Automated authenticity and completeness check' },
  { stepName: 'hr_approval', departmentName: 'HR', description: 'HR review of profile and documentation' },
  // IT-owned (Rahul Mehta) — reviews the AI-generated team/date/reporting-structure report, then
  // approves it, before this counts as done.
  { stepName: 'manager_approval', departmentName: 'IT', description: 'Team placement, reporting structure, and role/start date confirmed' },
  // Manager-owned (Diego Ramirez) rather than IT.
  { stepName: 'it_account_creation', departmentName: 'Manager', description: 'Email, SSO, and system access provisioned' },
  // Also Manager-owned (Diego Ramirez) — Rahul Mehta (IT) keeps manager_approval only.
  { stepName: 'asset_allocation', departmentName: 'Manager', description: 'Laptop and peripherals assigned' },
  // Manager-owned too (Diego Ramirez) — notified right after asset_allocation, same one-after-the-other flow.
  { stepName: 'it_verification', departmentName: 'Manager', description: 'IT confirms provisioning and access are complete' },
  { stepName: 'finance_verification', departmentName: 'Finance', description: 'Finance confirms payroll and reimbursement setup' },
  { stepName: 'legal_verification', departmentName: 'Legal', description: 'Legal confirms signed agreements and compliance docs' },
  { stepName: 'knowledge_base_access', departmentName: 'HR', description: 'Onboarding docs and team spaces granted' },
  { stepName: 'completed', departmentName: 'HR', description: 'Employee fully onboarded and active' },
] as const

// asset_allocation and it_verification have no entries here — unlike every other step, neither has
// a subtask checklist at all. Both are a single AI-generated summary (see
// lib/asset-allocation-report.ts / lib/it-verification-report.ts, generated on Notify) that Diego
// reviews and approves with one plain "Approve" button (see task-actions.ts).
const ONBOARDING_SUBTASKS_BY_STEP: Record<string, string[]> = {
  manager_approval: ['Review team, start date & reporting structure', 'Approve team & reporting assignment'],
  it_account_creation: ['Review account & login credentials', 'Approve account creation'],
  finance_verification: [
    'Confirm bank/tax details submitted',
    'Set up payroll entry',
    'Set up expense/reimbursement account',
    'Sign off finance readiness',
  ],
  legal_verification: [
    'Confirm signed offer letter on file',
    'Confirm NDA/IP agreement signed',
    'Confirm compliance docs (background check, work authorization)',
    'Sign off legal readiness',
  ],
}

const OFFBOARDING_TEMPLATE_STEPS = [
  { stepName: 'exit_initiated', departmentName: 'HR', description: 'Resignation or termination logged' },
  { stepName: 'manager_exit_approval', departmentName: 'Manager', description: 'Reporting manager acknowledges the exit' },
  { stepName: 'hr_exit_approval', departmentName: 'HR', description: 'HR reviews and approves the exit' },
  // Knowledge transfer is coordinated by the reporting manager with the team, so it stays
  // Manager-owned rather than HR — same non-department_fixed treatment as manager_approval.
  { stepName: 'knowledge_transfer', departmentName: 'Manager', description: 'Handover of projects and documentation to the team' },
  { stepName: 'it_access_deactivation', departmentName: 'IT', description: 'Email, SSO, and system access revoked' },
  { stepName: 'asset_recovery', departmentName: 'IT', description: 'Laptop and peripherals returned' },
  { stepName: 'finance_settlement', departmentName: 'Finance', description: 'Final payroll and settlement processed' },
  { stepName: 'legal_clearance', departmentName: 'Legal', description: 'Legal and compliance clearance confirmed' },
  { stepName: 'exit_completed', departmentName: 'HR', description: 'Employee fully offboarded and access revoked' },
] as const

const OFFBOARDING_SUBTASKS_BY_STEP: Record<string, string[]> = {
  it_access_deactivation: [
    'Revoke email & system access',
    'Remove from groups/channels',
    'Disable VPN/remote access',
    'Confirm all access revoked',
  ],
  asset_recovery: [
    'Confirm laptop/device returned',
    'Confirm peripherals returned',
    'Inspect returned assets for damage',
    "Update asset status to 'available'",
  ],
  finance_settlement: [
    'Process final payroll',
    'Settle pending reimbursements',
    'Confirm no outstanding advances',
    'Close payroll record',
  ],
  legal_clearance: [
    'Confirm exit interview/NDA reminder completed',
    'Confirm no pending disciplinary/legal matters',
    'Sign off legal clearance',
  ],
}

function seedRolesAndDepartments() {
  const roles = new Map<string, Role>(ROLE_NAMES.map((name) => [name, getOrCreateRole(name)]))
  const departments = new Map<string, Department>(DEPARTMENT_NAMES.map((name) => [name, getOrCreateDepartment(name)]))
  return { roles, departments }
}

function seedUsers(roles: Map<string, Role>, departments: Map<string, Department>) {
  const users = new Map<string, User>()
  for (const demo of [...EXISTING_DEMO_USERS, ...NEW_DEMO_USERS]) {
    const role = roles.get(demo.role)
    if (!role) throw new Error(`Unknown role: ${demo.role}`)
    const department = departments.get(demo.department) ?? null
    const user =
      getUserByEmail(demo.email) ??
      createUser({
        name: demo.name,
        email: demo.email,
        hashedPassword: hashPassword(demo.password),
        roleId: role.id,
        departmentId: department?.id ?? null,
      })
    users.set(demo.email, user)
  }
  return users
}

function seedTemplate(
  type: WorkflowType,
  name: string,
  templateSteps: readonly { stepName: string; departmentName: string; description: string }[],
  subtasksByStep: Record<string, string[]>,
) {
  const template = getWorkflowTemplateByType(type) ?? createWorkflowTemplate({ name, type })

  const existingSteps = listTemplateSteps(template.id)
  const stepsByName = new Map(existingSteps.map((step) => [step.stepName, step]))

  if (stepsByName.size === 0) {
    templateSteps.forEach((step, index) => {
      const created = createTemplateStep({
        templateId: template.id,
        stepName: step.stepName,
        departmentName: step.departmentName,
        stepOrder: index + 1,
        description: step.description,
      })
      stepsByName.set(step.stepName, created)
    })
  }

  for (const [stepName, titles] of Object.entries(subtasksByStep)) {
    const step = stepsByName.get(stepName)
    if (!step) throw new Error(`Missing template step for subtasks: ${stepName}`)
    if (listSubtaskTemplatesByStep(step.id).length > 0) continue
    titles.forEach((title, index) => createSubtaskTemplate({ stepId: step.id, title, itemOrder: index + 1 }))
  }

  return { template, stepsByName }
}

function seedEmployee(
  user: User,
  input: { empCode: string; firstName: string; lastName: string; dateOfJoining?: string | null; dateOfLeaving?: string | null },
) {
  const existing = getEmployeeByUserId(user.id)
  if (existing) return existing
  return createEmployee({
    userId: user.id,
    empCode: input.empCode,
    firstName: input.firstName,
    lastName: input.lastName,
    departmentId: user.departmentId,
    dateOfJoining: input.dateOfJoining ?? null,
    dateOfLeaving: input.dateOfLeaving ?? null,
  })
}

/** A lighter-weight seed for a workflow that just needs to exist with a handful of steps pre-verified. */
function seedSimpleWorkflow(
  employeeId: string,
  type: WorkflowType,
  stepsByName: Map<string, WorkflowStep>,
  orderedStepNames: readonly string[],
  verifiedStepNames: readonly string[],
  hrUserId: string,
) {
  const existing = listWorkflowsByEmployee(employeeId)
  if (existing.length > 0) return existing[0]

  const firstUnverifiedName = orderedStepNames.find((name) => !verifiedStepNames.includes(name))
  const currentStep = firstUnverifiedName ? stepsByName.get(firstUnverifiedName) : undefined

  const workflow = createWorkflow({ employeeId, type, status: 'in_progress', currentStepId: currentStep?.id ?? null })

  for (const stepName of verifiedStepNames) {
    const step = stepsByName.get(stepName)
    if (!step) throw new Error(`Missing step: ${stepName}`)
    createApproval({
      workflowId: workflow.id,
      stepId: step.id,
      approverId: hrUserId,
      status: 'verified',
      verifiedBy: hrUserId,
      verifiedAt: new Date().toISOString(),
    })
  }

  return workflow
}

function logWorkflow(label: string, workflowId: string) {
  const orderedSteps = getWorkflowSteps(workflowId)
  console.log(`\n${label} (${workflowId}) — ${orderedSteps.length} ordered steps:`)
  orderedSteps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.stepName} (${step.departmentName})${step.isAdhoc ? ' [ad-hoc]' : ''}`)
  })

  const approvals = listApprovalsByWorkflow(workflowId)
  console.log(`  Approvals (${approvals.length}):`)
  approvals.forEach((approval) => {
    const step = orderedSteps.find((s) => s.id === approval.stepId)
    console.log(`    - ${step?.stepName ?? approval.stepId}: ${approval.status}`)
  })

  return orderedSteps
}

function main() {
  const { roles, departments } = seedRolesAndDepartments()
  const users = seedUsers(roles, departments)

  const { stepsByName: onboardingSteps } = seedTemplate('onboarding', 'Standard Onboarding', ONBOARDING_TEMPLATE_STEPS, ONBOARDING_SUBTASKS_BY_STEP)
  const { stepsByName: offboardingSteps } = seedTemplate(
    'offboarding',
    'Standard Offboarding',
    OFFBOARDING_TEMPLATE_STEPS,
    OFFBOARDING_SUBTASKS_BY_STEP,
  )

  const elenaUser = users.get('elena@knowledgeos.demo')
  const meiUser = users.get('mei@knowledgeos.demo')
  const jamesUser = users.get('james@knowledgeos.demo')
  const priyaUser = users.get('priya@knowledgeos.demo')
  if (!elenaUser || !meiUser || !jamesUser || !priyaUser) throw new Error('Expected Elena, Mei, James, and Priya to be seeded as users')

  // No pre-verified steps: Elena is the live test case for actually walking an onboarding
  // through end to end, so her workflow starts with every step untouched.
  const elenaEmployee = seedEmployee(elenaUser, { empCode: 'EMP-ELENA', firstName: 'Elena', lastName: 'Petrova', dateOfJoining: '2025-02-10' })
  const elenaWorkflow = seedSimpleWorkflow(
    elenaEmployee.id,
    'onboarding',
    onboardingSteps,
    ONBOARDING_TEMPLATE_STEPS.map((s) => s.stepName),
    [],
    priyaUser.id,
  )

  const meiEmployee = seedEmployee(meiUser, {
    empCode: 'EMP-MEI',
    firstName: 'Mei',
    lastName: 'Tanaka',
    dateOfJoining: '2024-03-01',
    dateOfLeaving: '2026-09-20',
  })
  const meiWorkflow = seedSimpleWorkflow(
    meiEmployee.id,
    'offboarding',
    offboardingSteps,
    OFFBOARDING_TEMPLATE_STEPS.map((s) => s.stepName),
    ['exit_initiated'],
    priyaUser.id,
  )

  // James exists purely so Manager-scoped access (Diego, Engineering) has a real workflow
  // to see in its own department — everyone else seeded so far is Product/Sales.
  const jamesEmployee = seedEmployee(jamesUser, { empCode: 'EMP-JAMES', firstName: 'James', lastName: 'Okoro', dateOfJoining: '2025-08-01' })
  const jamesWorkflow = seedSimpleWorkflow(
    jamesEmployee.id,
    'onboarding',
    onboardingSteps,
    ONBOARDING_TEMPLATE_STEPS.map((s) => s.stepName),
    [],
    priyaUser.id,
  )

  console.log(`\nRoles (${roles.size}):`, Array.from(roles.keys()).join(', '))
  console.log(`Departments (${departments.size}):`, Array.from(departments.keys()).join(', '))
  console.log(`Users (${users.size}):`, Array.from(users.values()).map((u) => u.email).join(', '))

  console.log(`\nOnboarding template steps (${onboardingSteps.size}):`)
  for (const [name, step] of onboardingSteps) {
    const subtasks = listSubtaskTemplatesByStep(step.id)
    console.log(`  - ${name}${subtasks.length > 0 ? ` [${subtasks.length} subtask templates]` : ''}`)
  }

  console.log(`\nOffboarding template steps (${offboardingSteps.size}):`)
  for (const [name, step] of offboardingSteps) {
    const subtasks = listSubtaskTemplatesByStep(step.id)
    console.log(`  - ${name}${subtasks.length > 0 ? ` [${subtasks.length} subtask templates]` : ''}`)
  }

  const elenaOrdered = logWorkflow('Elena Petrova (onboarding)', elenaWorkflow.id)
  const meiOrdered = logWorkflow('Mei Tanaka (offboarding)', meiWorkflow.id)
  logWorkflow('James Okoro (onboarding)', jamesWorkflow.id)

  if (elenaOrdered.length !== 12) throw new Error(`Expected exactly 12 ordered steps for Elena's onboarding workflow, got ${elenaOrdered.length}`)
  if (meiOrdered.length !== 9) throw new Error(`Expected 9 ordered steps for Mei's offboarding workflow, got ${meiOrdered.length}`)
}

main()

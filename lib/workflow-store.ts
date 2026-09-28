import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const STORE_DIR = path.join(process.cwd(), 'storage')
const DB_FILE = path.join(STORE_DIR, 'workflows.db')

let dbInstance: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const db = new DatabaseSync(DB_FILE)
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      hashed_password TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id),
      department_id TEXT REFERENCES departments(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      emp_code TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      department_id TEXT REFERENCES departments(id),
      manager_id TEXT REFERENCES employees(id),
      date_of_joining TEXT,
      date_of_leaving TEXT
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      asset_type TEXT,
      serial_number TEXT,
      assigned_employee_id TEXT REFERENCES employees(id),
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('onboarding','offboarding'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      type TEXT NOT NULL CHECK (type IN ('onboarding','offboarding')),
      status TEXT NOT NULL,
      current_step_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      template_id TEXT REFERENCES workflow_templates(id),
      workflow_id TEXT REFERENCES workflows(id),
      step_name TEXT NOT NULL,
      department_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      description TEXT,
      is_adhoc INTEGER NOT NULL DEFAULT 0,
      insert_after_step_id TEXT REFERENCES workflow_steps(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      approver_id TEXT REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('pending','allocated','in_progress','completed','verified')),
      comment TEXT,
      created_at TEXT NOT NULL,
      verified_by TEXT REFERENCES users(id),
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subtask_templates (
      id TEXT PRIMARY KEY,
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      title TEXT NOT NULL,
      item_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL REFERENCES approvals(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','completed')) DEFAULT 'pending',
      completed_at TEXT,
      completed_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      role_id TEXT REFERENCES roles(id),
      approval_id TEXT REFERENCES approvals(id),
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee_detail_submissions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      employee_id TEXT NOT NULL REFERENCES employees(id),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      role_title TEXT NOT NULL,
      department TEXT NOT NULL,
      start_date TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      submitted_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS employee_documents (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      employee_id TEXT NOT NULL REFERENCES employees(id),
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_mime_type TEXT NOT NULL,
      file_data TEXT NOT NULL,
      extracted_fields TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS document_verification_results (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      overall_status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      run_at TEXT NOT NULL,
      run_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_approval_profile_entries (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      markdown TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL,
      document_name TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS manager_approval_reports (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      markdown TEXT NOT NULL,
      summary TEXT NOT NULL,
      team_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      role_title TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS it_account_reports (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      markdown TEXT NOT NULL,
      summary TEXT NOT NULL,
      email TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS asset_allocation_summaries (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      approval_id TEXT NOT NULL REFERENCES approvals(id),
      summary_text TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS it_verification_summaries (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_id TEXT NOT NULL REFERENCES workflow_steps(id),
      approval_id TEXT NOT NULL REFERENCES approvals(id),
      summary_text TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
    CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);
    CREATE INDEX IF NOT EXISTS idx_assets_assigned_employee_id ON assets(assigned_employee_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_employee_id ON workflows(employee_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_template_id ON workflow_steps(template_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_workflow_id ON approvals(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_step_id ON approvals(step_id);
    CREATE INDEX IF NOT EXISTS idx_subtask_templates_step_id ON subtask_templates(step_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_approval_id ON subtasks(approval_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_role_id ON notifications(role_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_approval_id ON notifications(approval_id);
    CREATE INDEX IF NOT EXISTS idx_employee_detail_submissions_workflow_id ON employee_detail_submissions(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_workflow_id ON employee_documents(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_document_verification_results_workflow_id ON document_verification_results(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_hr_approval_profile_entries_workflow_id ON hr_approval_profile_entries(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_manager_approval_reports_workflow_id ON manager_approval_reports(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_it_account_reports_workflow_id ON it_account_reports(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_asset_allocation_summaries_workflow_id ON asset_allocation_summaries(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_it_verification_summaries_workflow_id ON it_verification_summaries(workflow_id);
  `)

  // hr_approval_profile_entries gained `summary` after the table already existed on disk for
  // anyone who ran the earlier version — CREATE TABLE IF NOT EXISTS above won't retrofit it, so
  // add it here. Harmless no-op (caught and ignored) once the column is already present.
  try {
    db.exec("ALTER TABLE hr_approval_profile_entries ADD COLUMN summary TEXT NOT NULL DEFAULT ''")
  } catch {
    // Column already exists.
  }

  // Department ownership here has flipped a few times, so this is set unconditionally (not
  // guarded by "AND department_name = <previous value>") — it always converges to the current
  // desired owner on startup regardless of what it was before, rather than depending on correctly
  // tracking the prior state. Current split: manager_approval -> IT (Rahul Mehta), asset_allocation
  // -> Manager (Diego Ramirez), it_account_creation -> Manager (Diego), it_verification -> Manager
  // (Diego too, notified right after asset_allocation). manager_approval keeps its 2-item checklist regardless of owner:
  // review the AI-generated team/date/reporting-structure report, then approve it — approving is
  // refused until the review step has actually produced that report (see task-actions.ts).
  // CREATE TABLE IF NOT EXISTS above only affects brand-new databases, so fix up the shared
  // template step + its subtask templates here too. The subtask titles are always synced to the
  // canonical pair (delete + re-insert) rather than guarded by a one-time count check, so an
  // earlier version's stale titles get corrected on next startup too — safe because
  // subtask_templates is only a blueprint for future Notify calls, never touched by an approval
  // already in progress (those already own their own copied-out subtask rows).
  try {
    const managerApprovalStep = db
      .prepare("SELECT id FROM workflow_steps WHERE step_name = 'manager_approval'")
      .get() as { id: string } | undefined
    if (managerApprovalStep) {
      db.prepare(
        "UPDATE workflow_steps SET department_name = 'IT', description = 'Team placement, reporting structure, and role/start date confirmed' WHERE id = ?",
      ).run(managerApprovalStep.id)
      db.prepare('DELETE FROM subtask_templates WHERE step_id = ?').run(managerApprovalStep.id)
      const insertTemplate = db.prepare(
        'INSERT INTO subtask_templates (id, step_id, title, item_order) VALUES (?, ?, ?, ?)',
      )
      insertTemplate.run(genId('subtpl'), managerApprovalStep.id, 'Review team, start date & reporting structure', 1)
      insertTemplate.run(genId('subtpl'), managerApprovalStep.id, 'Approve team & reporting assignment', 2)
    }
  } catch (error) {
    console.error('[v0] manager_approval content fixup failed:', error)
  }

  // asset_allocation moves from IT to Manager (Diego Ramirez) — same unconditional-set reasoning
  // as above. No subtask checklist anymore: this step is now a single AI-generated summary
  // (see lib/asset-allocation-report.ts, generated on Notify) reviewed via one plain "Approve"
  // button (see task-actions.ts) — any subtask_templates left over from the earlier
  // checkbox-based version are deleted and never re-inserted.
  try {
    const assetAllocationStep = db
      .prepare("SELECT id FROM workflow_steps WHERE step_name = 'asset_allocation'")
      .get() as { id: string } | undefined
    if (assetAllocationStep) {
      db.prepare("UPDATE workflow_steps SET department_name = 'Manager' WHERE id = ?").run(assetAllocationStep.id)
      db.prepare('DELETE FROM subtask_templates WHERE step_id = ?').run(assetAllocationStep.id)
    }
  } catch (error) {
    console.error('[v0] asset_allocation content fixup failed:', error)
  }

  // it_account_creation's checklist is now a 2-item pair mirroring manager_approval's shape —
  // neither item is a plain checkbox: "Review" runs the AI account/credentials summary (email +
  // temporary password, see generateItAccountCredentials in task-actions.ts), "Approve" only ever
  // completes once that summary exists (see approveItAccountCreation). Same always-sync-to-
  // canonical approach as the fixups above, for the same reasons: Diego (Manager) does
  // account/access setup, asset_allocation, and it_verification; Rahul (IT) keeps only
  // manager_approval.
  try {
    const itAccountStep = db
      .prepare("SELECT id FROM workflow_steps WHERE step_name = 'it_account_creation'")
      .get() as { id: string } | undefined
    if (itAccountStep) {
      db.prepare("UPDATE workflow_steps SET department_name = 'Manager' WHERE id = ?").run(itAccountStep.id)
      db.prepare('DELETE FROM subtask_templates WHERE step_id = ?').run(itAccountStep.id)
      const insertTemplate = db.prepare(
        'INSERT INTO subtask_templates (id, step_id, title, item_order) VALUES (?, ?, ?, ?)',
      )
      insertTemplate.run(genId('subtpl'), itAccountStep.id, 'Review account & login credentials', 1)
      insertTemplate.run(genId('subtpl'), itAccountStep.id, 'Approve account creation', 2)
    }
  } catch (error) {
    console.error('[v0] it_account_creation content fixup failed:', error)
  }

  // it_verification moves from IT to Manager (Diego Ramirez) too — notified right after
  // asset_allocation, same one-after-the-other Notify flow, same unconditional-set reasoning as
  // the fixups above. No subtask checklist: like asset_allocation, this is a single AI-generated
  // summary (see lib/it-verification-report.ts) reviewed via one plain "Approve" button — any
  // subtask_templates left over from the earlier checkbox-based version are deleted and never
  // re-inserted.
  try {
    const itVerificationStep = db
      .prepare("SELECT id FROM workflow_steps WHERE step_name = 'it_verification'")
      .get() as { id: string } | undefined
    if (itVerificationStep) {
      db.prepare("UPDATE workflow_steps SET department_name = 'Manager' WHERE id = ?").run(itVerificationStep.id)
      db.prepare('DELETE FROM subtask_templates WHERE step_id = ?').run(itVerificationStep.id)
    }
  } catch (error) {
    console.error('[v0] it_verification content fixup failed:', error)
  }

  dbInstance = db
  return db
}

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Runs `fn` (a sequence of the create/update calls above, which all share this module's single connection) as one transaction. */
export function runInTransaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ---------- Roles ----------

export type Role = { id: string; name: string; description: string | null }

type RoleRow = { id: string; name: string; description: string | null }

export function listRoles(): Role[] {
  return getDb().prepare('SELECT id, name, description FROM roles ORDER BY name').all() as RoleRow[]
}

export function getRoleByName(name: string): Role | null {
  return (getDb().prepare('SELECT id, name, description FROM roles WHERE name = ?').get(name) as RoleRow | undefined) ?? null
}

export function getRoleById(id: string): Role | null {
  return (getDb().prepare('SELECT id, name, description FROM roles WHERE id = ?').get(id) as RoleRow | undefined) ?? null
}

/** Inserts the role if a role with this name doesn't already exist; otherwise returns the existing one. */
export function getOrCreateRole(name: string, description?: string): Role {
  const existing = getRoleByName(name)
  if (existing) return existing
  const role: Role = { id: genId('role'), name, description: description ?? null }
  getDb().prepare('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)').run(role.id, role.name, role.description)
  return role
}

// ---------- Departments ----------

export type Department = { id: string; name: string; description: string | null }

type DepartmentRow = { id: string; name: string; description: string | null }

export function listDepartments(): Department[] {
  return getDb().prepare('SELECT id, name, description FROM departments ORDER BY name').all() as DepartmentRow[]
}

export function getDepartmentByName(name: string): Department | null {
  return (getDb().prepare('SELECT id, name, description FROM departments WHERE name = ?').get(name) as DepartmentRow | undefined) ?? null
}

export function getDepartmentById(id: string): Department | null {
  return (getDb().prepare('SELECT id, name, description FROM departments WHERE id = ?').get(id) as DepartmentRow | undefined) ?? null
}

export function getOrCreateDepartment(name: string, description?: string): Department {
  const existing = getDepartmentByName(name)
  if (existing) return existing
  const department: Department = { id: genId('dept'), name, description: description ?? null }
  getDb()
    .prepare('INSERT INTO departments (id, name, description) VALUES (?, ?, ?)')
    .run(department.id, department.name, department.description)
  return department
}

// ---------- Users ----------

export type User = {
  id: string
  name: string
  email: string
  hashedPassword: string
  roleId: string
  departmentId: string | null
  isActive: boolean
  createdAt: string
}

type UserRow = {
  id: string
  name: string
  email: string
  hashed_password: string
  role_id: string
  department_id: string | null
  is_active: number
  created_at: string
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    hashedPassword: row.hashed_password,
    roleId: row.role_id,
    departmentId: row.department_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  }
}

const USER_COLUMNS = 'id, name, email, hashed_password, role_id, department_id, is_active, created_at'

export function createUser(input: {
  name: string
  email: string
  hashedPassword: string
  roleId: string
  departmentId?: string | null
  isActive?: boolean
}): User {
  const row: UserRow = {
    id: genId('user'),
    name: input.name,
    email: input.email,
    hashed_password: input.hashedPassword,
    role_id: input.roleId,
    department_id: input.departmentId ?? null,
    is_active: input.isActive === false ? 0 : 1,
    created_at: nowIso(),
  }
  getDb()
    .prepare(`INSERT INTO users (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.name, row.email, row.hashed_password, row.role_id, row.department_id, row.is_active, row.created_at)
  return mapUser(row)
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined
  return row ? mapUser(row) : null
}

export function getUserByEmail(email: string): User | null {
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).get(email) as UserRow | undefined
  return row ? mapUser(row) : null
}

export function listUsers(): User[] {
  const rows = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`).all() as UserRow[]
  return rows.map(mapUser)
}

export function listUsersByRole(roleId: string): User[] {
  const rows = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE role_id = ? ORDER BY created_at`).all(roleId) as UserRow[]
  return rows.map(mapUser)
}

// ---------- Employees ----------

export type Employee = {
  id: string
  userId: string
  empCode: string
  firstName: string
  lastName: string
  departmentId: string | null
  managerId: string | null
  dateOfJoining: string | null
  dateOfLeaving: string | null
}

type EmployeeRow = {
  id: string
  user_id: string
  emp_code: string
  first_name: string
  last_name: string
  department_id: string | null
  manager_id: string | null
  date_of_joining: string | null
  date_of_leaving: string | null
}

function mapEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    userId: row.user_id,
    empCode: row.emp_code,
    firstName: row.first_name,
    lastName: row.last_name,
    departmentId: row.department_id,
    managerId: row.manager_id,
    dateOfJoining: row.date_of_joining,
    dateOfLeaving: row.date_of_leaving,
  }
}

const EMPLOYEE_COLUMNS = 'id, user_id, emp_code, first_name, last_name, department_id, manager_id, date_of_joining, date_of_leaving'

export function createEmployee(input: {
  userId: string
  empCode: string
  firstName: string
  lastName: string
  departmentId?: string | null
  managerId?: string | null
  dateOfJoining?: string | null
  dateOfLeaving?: string | null
}): Employee {
  const row: EmployeeRow = {
    id: genId('emp'),
    user_id: input.userId,
    emp_code: input.empCode,
    first_name: input.firstName,
    last_name: input.lastName,
    department_id: input.departmentId ?? null,
    manager_id: input.managerId ?? null,
    date_of_joining: input.dateOfJoining ?? null,
    date_of_leaving: input.dateOfLeaving ?? null,
  }
  getDb()
    .prepare(`INSERT INTO employees (${EMPLOYEE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.user_id,
      row.emp_code,
      row.first_name,
      row.last_name,
      row.department_id,
      row.manager_id,
      row.date_of_joining,
      row.date_of_leaving,
    )
  return mapEmployee(row)
}

export function getEmployeeById(id: string): Employee | null {
  const row = getDb().prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ?`).get(id) as EmployeeRow | undefined
  return row ? mapEmployee(row) : null
}

export function getEmployeeByUserId(userId: string): Employee | null {
  const row = getDb().prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE user_id = ?`).get(userId) as EmployeeRow | undefined
  return row ? mapEmployee(row) : null
}

// ---------- Assets ----------

export type Asset = {
  id: string
  name: string
  assetType: string | null
  serialNumber: string | null
  assignedEmployeeId: string | null
  status: string | null
}

type AssetRow = {
  id: string
  name: string
  asset_type: string | null
  serial_number: string | null
  assigned_employee_id: string | null
  status: string | null
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type,
    serialNumber: row.serial_number,
    assignedEmployeeId: row.assigned_employee_id,
    status: row.status,
  }
}

export function createAsset(input: {
  name: string
  assetType?: string | null
  serialNumber?: string | null
  assignedEmployeeId?: string | null
  status?: string | null
}): Asset {
  const row: AssetRow = {
    id: genId('asset'),
    name: input.name,
    asset_type: input.assetType ?? null,
    serial_number: input.serialNumber ?? null,
    assigned_employee_id: input.assignedEmployeeId ?? null,
    status: input.status ?? null,
  }
  getDb()
    .prepare('INSERT INTO assets (id, name, asset_type, serial_number, assigned_employee_id, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.name, row.asset_type, row.serial_number, row.assigned_employee_id, row.status)
  return mapAsset(row)
}

export function listAssetsByEmployee(employeeId: string): Asset[] {
  const rows = getDb()
    .prepare('SELECT id, name, asset_type, serial_number, assigned_employee_id, status FROM assets WHERE assigned_employee_id = ?')
    .all(employeeId) as AssetRow[]
  return rows.map(mapAsset)
}

// ---------- Workflow templates ----------

export type WorkflowType = 'onboarding' | 'offboarding'

export type WorkflowTemplate = { id: string; name: string; type: WorkflowType }

type WorkflowTemplateRow = { id: string; name: string; type: WorkflowType }

export function createWorkflowTemplate(input: { name: string; type: WorkflowType }): WorkflowTemplate {
  const row: WorkflowTemplateRow = { id: genId('tmpl'), name: input.name, type: input.type }
  getDb().prepare('INSERT INTO workflow_templates (id, name, type) VALUES (?, ?, ?)').run(row.id, row.name, row.type)
  return row
}

export function getWorkflowTemplateById(id: string): WorkflowTemplate | null {
  return (getDb().prepare('SELECT id, name, type FROM workflow_templates WHERE id = ?').get(id) as WorkflowTemplateRow | undefined) ?? null
}

/** There's currently one active template per type, so a workflow's steps are resolved by matching `workflows.type`. */
export function getWorkflowTemplateByType(type: WorkflowType): WorkflowTemplate | null {
  return (
    (getDb().prepare('SELECT id, name, type FROM workflow_templates WHERE type = ?').get(type) as WorkflowTemplateRow | undefined) ?? null
  )
}

// ---------- Workflow steps ----------

export type WorkflowStep = {
  id: string
  templateId: string | null
  workflowId: string | null
  stepName: string
  departmentName: string
  stepOrder: number
  description: string | null
  isAdhoc: boolean
  insertAfterStepId: string | null
}

type WorkflowStepRow = {
  id: string
  template_id: string | null
  workflow_id: string | null
  step_name: string
  department_name: string
  step_order: number
  description: string | null
  is_adhoc: number
  insert_after_step_id: string | null
}

function mapWorkflowStep(row: WorkflowStepRow): WorkflowStep {
  return {
    id: row.id,
    templateId: row.template_id,
    workflowId: row.workflow_id,
    stepName: row.step_name,
    departmentName: row.department_name,
    stepOrder: row.step_order,
    description: row.description,
    isAdhoc: row.is_adhoc === 1,
    insertAfterStepId: row.insert_after_step_id,
  }
}

const WORKFLOW_STEP_COLUMNS =
  'id, template_id, workflow_id, step_name, department_name, step_order, description, is_adhoc, insert_after_step_id'

/** A standard step shared by every workflow that follows this template. */
export function createTemplateStep(input: {
  templateId: string
  stepName: string
  departmentName: string
  stepOrder: number
  description?: string | null
}): WorkflowStep {
  const row: WorkflowStepRow = {
    id: genId('step'),
    template_id: input.templateId,
    workflow_id: null,
    step_name: input.stepName,
    department_name: input.departmentName,
    step_order: input.stepOrder,
    description: input.description ?? null,
    is_adhoc: 0,
    insert_after_step_id: null,
  }
  insertWorkflowStepRow(row)
  return mapWorkflowStep(row)
}

/** An ad-hoc step HR inserts into ONE specific employee's workflow only, positioned after `insertAfterStepId`. */
export function createAdhocStep(input: {
  workflowId: string
  stepName: string
  departmentName: string
  stepOrder: number
  description?: string | null
  insertAfterStepId?: string | null
}): WorkflowStep {
  const row: WorkflowStepRow = {
    id: genId('step'),
    template_id: null,
    workflow_id: input.workflowId,
    step_name: input.stepName,
    department_name: input.departmentName,
    step_order: input.stepOrder,
    description: input.description ?? null,
    is_adhoc: 1,
    insert_after_step_id: input.insertAfterStepId ?? null,
  }
  insertWorkflowStepRow(row)
  return mapWorkflowStep(row)
}

function insertWorkflowStepRow(row: WorkflowStepRow) {
  getDb()
    .prepare(`INSERT INTO workflow_steps (${WORKFLOW_STEP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.template_id,
      row.workflow_id,
      row.step_name,
      row.department_name,
      row.step_order,
      row.description,
      row.is_adhoc,
      row.insert_after_step_id,
    )
}

export function getWorkflowStepById(id: string): WorkflowStep | null {
  const row = getDb().prepare(`SELECT ${WORKFLOW_STEP_COLUMNS} FROM workflow_steps WHERE id = ?`).get(id) as WorkflowStepRow | undefined
  return row ? mapWorkflowStep(row) : null
}

export function listTemplateSteps(templateId: string): WorkflowStep[] {
  const rows = getDb()
    .prepare(`SELECT ${WORKFLOW_STEP_COLUMNS} FROM workflow_steps WHERE template_id = ? ORDER BY step_order`)
    .all(templateId) as WorkflowStepRow[]
  return rows.map(mapWorkflowStep)
}

export function listAdhocStepsForWorkflow(workflowId: string): WorkflowStep[] {
  const rows = getDb()
    .prepare(`SELECT ${WORKFLOW_STEP_COLUMNS} FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order`)
    .all(workflowId) as WorkflowStepRow[]
  return rows.map(mapWorkflowStep)
}

// ---------- Workflows ----------

export type Workflow = {
  id: string
  employeeId: string
  type: WorkflowType
  status: string
  currentStepId: string | null
  createdAt: string
  updatedAt: string
}

type WorkflowRow = {
  id: string
  employee_id: string
  type: WorkflowType
  status: string
  current_step_id: string | null
  created_at: string
  updated_at: string
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    status: row.status,
    currentStepId: row.current_step_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const WORKFLOW_COLUMNS = 'id, employee_id, type, status, current_step_id, created_at, updated_at'

export function createWorkflow(input: {
  employeeId: string
  type: WorkflowType
  status: string
  currentStepId?: string | null
}): Workflow {
  const timestamp = nowIso()
  const row: WorkflowRow = {
    id: genId('wf'),
    employee_id: input.employeeId,
    type: input.type,
    status: input.status,
    current_step_id: input.currentStepId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  getDb()
    .prepare(`INSERT INTO workflows (${WORKFLOW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.employee_id, row.type, row.status, row.current_step_id, row.created_at, row.updated_at)
  return mapWorkflow(row)
}

export function getWorkflow(id: string): Workflow | null {
  const row = getDb().prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflows WHERE id = ?`).get(id) as WorkflowRow | undefined
  return row ? mapWorkflow(row) : null
}

export function listWorkflowsByEmployee(employeeId: string): Workflow[] {
  const rows = getDb()
    .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflows WHERE employee_id = ? ORDER BY created_at`)
    .all(employeeId) as WorkflowRow[]
  return rows.map(mapWorkflow)
}

export function listAllWorkflows(): Workflow[] {
  const rows = getDb().prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflows ORDER BY created_at`).all() as WorkflowRow[]
  return rows.map(mapWorkflow)
}

export function updateWorkflowCurrentStep(workflowId: string, currentStepId: string | null, status?: string) {
  const db = getDb()
  if (status) {
    db.prepare('UPDATE workflows SET current_step_id = ?, status = ?, updated_at = ? WHERE id = ?').run(
      currentStepId,
      status,
      nowIso(),
      workflowId,
    )
  } else {
    db.prepare('UPDATE workflows SET current_step_id = ?, updated_at = ? WHERE id = ?').run(currentStepId, nowIso(), workflowId)
  }
}

/**
 * Merges this workflow's template steps with any ad-hoc steps created for it alone, in
 * timeline order. Ad-hoc steps are spliced in right after `insertAfterStepId`; several
 * ad-hoc steps anchored to the same step keep their relative insertion order.
 */
export function getWorkflowSteps(workflowId: string): WorkflowStep[] {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return []

  const template = getWorkflowTemplateByType(workflow.type)
  const merged = template ? listTemplateSteps(template.id) : []
  const adhocSteps = listAdhocStepsForWorkflow(workflowId)

  for (const step of adhocSteps) {
    const anchorIndex = step.insertAfterStepId ? merged.findIndex((s) => s.id === step.insertAfterStepId) : -1
    if (anchorIndex === -1) {
      merged.push(step)
      continue
    }
    let insertAt = anchorIndex + 1
    while (insertAt < merged.length && merged[insertAt].isAdhoc && merged[insertAt].insertAfterStepId === step.insertAfterStepId) {
      insertAt++
    }
    merged.splice(insertAt, 0, step)
  }

  return merged
}

// ---------- Approvals ----------

export type ApprovalStatus = 'pending' | 'allocated' | 'in_progress' | 'completed' | 'verified'

export type Approval = {
  id: string
  workflowId: string
  stepId: string
  approverId: string | null
  status: ApprovalStatus
  comment: string | null
  createdAt: string
  verifiedBy: string | null
  verifiedAt: string | null
}

type ApprovalRow = {
  id: string
  workflow_id: string
  step_id: string
  approver_id: string | null
  status: ApprovalStatus
  comment: string | null
  created_at: string
  verified_by: string | null
  verified_at: string | null
}

function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    approverId: row.approver_id,
    status: row.status,
    comment: row.comment,
    createdAt: row.created_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
  }
}

const APPROVAL_COLUMNS = 'id, workflow_id, step_id, approver_id, status, comment, created_at, verified_by, verified_at'

export function createApproval(input: {
  workflowId: string
  stepId: string
  approverId?: string | null
  status: ApprovalStatus
  comment?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  createdAt?: string
}): Approval {
  const row: ApprovalRow = {
    id: genId('appr'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    approver_id: input.approverId ?? null,
    status: input.status,
    comment: input.comment ?? null,
    created_at: input.createdAt ?? nowIso(),
    verified_by: input.verifiedBy ?? null,
    verified_at: input.verifiedAt ?? null,
  }
  getDb()
    .prepare(`INSERT INTO approvals (${APPROVAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.workflow_id,
      row.step_id,
      row.approver_id,
      row.status,
      row.comment,
      row.created_at,
      row.verified_by,
      row.verified_at,
    )
  return mapApproval(row)
}

export function getApproval(id: string): Approval | null {
  const row = getDb().prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`).get(id) as ApprovalRow | undefined
  return row ? mapApproval(row) : null
}

export function listApprovalsByWorkflow(workflowId: string): Approval[] {
  const rows = getDb()
    .prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE workflow_id = ? ORDER BY created_at`)
    .all(workflowId) as ApprovalRow[]
  return rows.map(mapApproval)
}

export function updateApprovalStatus(
  id: string,
  status: ApprovalStatus,
  extra?: { comment?: string | null; verifiedBy?: string | null; verifiedAt?: string | null },
) {
  getDb()
    .prepare('UPDATE approvals SET status = ?, comment = COALESCE(?, comment), verified_by = COALESCE(?, verified_by), verified_at = COALESCE(?, verified_at) WHERE id = ?')
    .run(status, extra?.comment ?? null, extra?.verifiedBy ?? null, extra?.verifiedAt ?? null, id)
}

// ---------- Subtask templates ----------

export type SubtaskTemplate = { id: string; stepId: string; title: string; itemOrder: number }

type SubtaskTemplateRow = { id: string; step_id: string; title: string; item_order: number }

function mapSubtaskTemplate(row: SubtaskTemplateRow): SubtaskTemplate {
  return { id: row.id, stepId: row.step_id, title: row.title, itemOrder: row.item_order }
}

export function createSubtaskTemplate(input: { stepId: string; title: string; itemOrder: number }): SubtaskTemplate {
  const row: SubtaskTemplateRow = { id: genId('subtmpl'), step_id: input.stepId, title: input.title, item_order: input.itemOrder }
  getDb()
    .prepare('INSERT INTO subtask_templates (id, step_id, title, item_order) VALUES (?, ?, ?, ?)')
    .run(row.id, row.step_id, row.title, row.item_order)
  return mapSubtaskTemplate(row)
}

export function listSubtaskTemplatesByStep(stepId: string): SubtaskTemplate[] {
  const rows = getDb()
    .prepare('SELECT id, step_id, title, item_order FROM subtask_templates WHERE step_id = ? ORDER BY item_order')
    .all(stepId) as SubtaskTemplateRow[]
  return rows.map(mapSubtaskTemplate)
}

// ---------- Subtasks ----------

export type SubtaskStatus = 'pending' | 'completed'

export type Subtask = {
  id: string
  approvalId: string
  title: string
  status: SubtaskStatus
  completedAt: string | null
  completedBy: string | null
}

type SubtaskRow = {
  id: string
  approval_id: string
  title: string
  status: SubtaskStatus
  completed_at: string | null
  completed_by: string | null
}

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    approvalId: row.approval_id,
    title: row.title,
    status: row.status,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  }
}

export function createSubtask(input: { approvalId: string; title: string; status?: SubtaskStatus }): Subtask {
  const row: SubtaskRow = {
    id: genId('subtask'),
    approval_id: input.approvalId,
    title: input.title,
    status: input.status ?? 'pending',
    completed_at: null,
    completed_by: null,
  }
  getDb()
    .prepare('INSERT INTO subtasks (id, approval_id, title, status, completed_at, completed_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.approval_id, row.title, row.status, row.completed_at, row.completed_by)
  return mapSubtask(row)
}

export function listSubtasksByApproval(approvalId: string): Subtask[] {
  const rows = getDb()
    .prepare('SELECT id, approval_id, title, status, completed_at, completed_by FROM subtasks WHERE approval_id = ?')
    .all(approvalId) as SubtaskRow[]
  return rows.map(mapSubtask)
}

export function getSubtaskById(id: string): Subtask | null {
  const row = getDb()
    .prepare('SELECT id, approval_id, title, status, completed_at, completed_by FROM subtasks WHERE id = ?')
    .get(id) as SubtaskRow | undefined
  return row ? mapSubtask(row) : null
}

export function updateSubtaskStatus(id: string, status: SubtaskStatus, completedBy: string | null) {
  getDb()
    .prepare('UPDATE subtasks SET status = ?, completed_at = ?, completed_by = ? WHERE id = ?')
    .run(status, status === 'completed' ? nowIso() : null, status === 'completed' ? completedBy : null, id)
}

// ---------- Notifications ----------

export type Notification = {
  id: string
  roleId: string | null
  approvalId: string | null
  message: string
  isRead: boolean
  createdAt: string
}

type NotificationRow = {
  id: string
  role_id: string | null
  approval_id: string | null
  message: string
  is_read: number
  created_at: string
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    roleId: row.role_id,
    approvalId: row.approval_id,
    message: row.message,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  }
}

export function createNotification(input: { roleId?: string | null; approvalId?: string | null; message: string }): Notification {
  const row: NotificationRow = {
    id: genId('notif'),
    role_id: input.roleId ?? null,
    approval_id: input.approvalId ?? null,
    message: input.message,
    is_read: 0,
    created_at: nowIso(),
  }
  getDb()
    .prepare('INSERT INTO notifications (id, role_id, approval_id, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.role_id, row.approval_id, row.message, row.is_read, row.created_at)
  return mapNotification(row)
}

export function listNotificationsByRole(roleId: string): Notification[] {
  const rows = getDb()
    .prepare('SELECT id, role_id, approval_id, message, is_read, created_at FROM notifications WHERE role_id = ? ORDER BY created_at DESC')
    .all(roleId) as NotificationRow[]
  return rows.map(mapNotification)
}

export function getNotificationById(id: string): Notification | null {
  const row = getDb()
    .prepare('SELECT id, role_id, approval_id, message, is_read, created_at FROM notifications WHERE id = ?')
    .get(id) as NotificationRow | undefined
  return row ? mapNotification(row) : null
}

export function countUnreadNotifications(roleId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE role_id = ? AND is_read = 0')
    .get(roleId) as { n: number }
  return row.n
}

export function markNotificationRead(id: string) {
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id)
}

export function markAllNotificationsRead(roleId: string) {
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE role_id = ? AND is_read = 0').run(roleId)
}

// ---------- Employee detail submissions ----------

export type EmployeeDetailSubmission = {
  id: string
  workflowId: string
  employeeId: string
  fullName: string
  email: string
  phone: string
  address: string | null
  roleTitle: string
  department: string
  startDate: string
  submittedAt: string
  submittedBy: string
}

type EmployeeDetailSubmissionRow = {
  id: string
  workflow_id: string
  employee_id: string
  full_name: string
  email: string
  phone: string
  address: string | null
  role_title: string
  department: string
  start_date: string
  submitted_at: string
  submitted_by: string
}

function mapEmployeeDetailSubmission(row: EmployeeDetailSubmissionRow): EmployeeDetailSubmission {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    employeeId: row.employee_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    roleTitle: row.role_title,
    department: row.department,
    startDate: row.start_date,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
  }
}

const EMPLOYEE_DETAIL_SUBMISSION_COLUMNS =
  'id, workflow_id, employee_id, full_name, email, phone, address, role_title, department, start_date, submitted_at, submitted_by'

export function createEmployeeDetailSubmission(input: {
  workflowId: string
  employeeId: string
  fullName: string
  email: string
  phone: string
  address?: string | null
  roleTitle: string
  department: string
  startDate: string
  submittedBy: string
  submittedAt?: string
}): EmployeeDetailSubmission {
  const row: EmployeeDetailSubmissionRow = {
    id: genId('empdetail'),
    workflow_id: input.workflowId,
    employee_id: input.employeeId,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    address: input.address ?? null,
    role_title: input.roleTitle,
    department: input.department,
    start_date: input.startDate,
    submitted_at: input.submittedAt ?? nowIso(),
    submitted_by: input.submittedBy,
  }
  getDb()
    .prepare(`INSERT INTO employee_detail_submissions (${EMPLOYEE_DETAIL_SUBMISSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.workflow_id,
      row.employee_id,
      row.full_name,
      row.email,
      row.phone,
      row.address,
      row.role_title,
      row.department,
      row.start_date,
      row.submitted_at,
      row.submitted_by,
    )
  return mapEmployeeDetailSubmission(row)
}

/** Editing/resubmitting inserts a new row rather than updating in place, so the latest submitted_at wins. */
export function getEmployeeDetailSubmissionByWorkflow(workflowId: string): EmployeeDetailSubmission | null {
  const row = getDb()
    .prepare(`SELECT ${EMPLOYEE_DETAIL_SUBMISSION_COLUMNS} FROM employee_detail_submissions WHERE workflow_id = ? ORDER BY submitted_at DESC LIMIT 1`)
    .get(workflowId) as EmployeeDetailSubmissionRow | undefined
  return row ? mapEmployeeDetailSubmission(row) : null
}

// ---------- Employee documents ----------

export type EmployeeDocument = {
  id: string
  workflowId: string
  employeeId: string
  documentType: string
  fileName: string
  /** e.g. "image/png", "application/pdf" — whatever the browser reported for the uploaded file. */
  fileMimeType: string
  /** The uploaded file's bytes, base64-encoded — there's no separate blob storage in this app. */
  fileData: string
  extractedFields: Record<string, string>
  uploadedAt: string
  uploadedBy: string
}

type EmployeeDocumentRow = {
  id: string
  workflow_id: string
  employee_id: string
  document_type: string
  file_name: string
  file_mime_type: string
  file_data: string
  extracted_fields: string
  uploaded_at: string
  uploaded_by: string
}

function mapEmployeeDocument(row: EmployeeDocumentRow): EmployeeDocument {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    employeeId: row.employee_id,
    documentType: row.document_type,
    fileName: row.file_name,
    fileMimeType: row.file_mime_type,
    fileData: row.file_data,
    extractedFields: JSON.parse(row.extracted_fields),
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
  }
}

const EMPLOYEE_DOCUMENT_COLUMNS =
  'id, workflow_id, employee_id, document_type, file_name, file_mime_type, file_data, extracted_fields, uploaded_at, uploaded_by'

export function createEmployeeDocument(input: {
  workflowId: string
  employeeId: string
  documentType: string
  fileName: string
  fileMimeType: string
  fileData: string
  extractedFields: Record<string, string>
  uploadedBy: string
  uploadedAt?: string
}): EmployeeDocument {
  const row: EmployeeDocumentRow = {
    id: genId('empdoc'),
    workflow_id: input.workflowId,
    employee_id: input.employeeId,
    document_type: input.documentType,
    file_name: input.fileName,
    file_mime_type: input.fileMimeType,
    file_data: input.fileData,
    extracted_fields: JSON.stringify(input.extractedFields),
    uploaded_at: input.uploadedAt ?? nowIso(),
    uploaded_by: input.uploadedBy,
  }
  getDb()
    .prepare(`INSERT INTO employee_documents (${EMPLOYEE_DOCUMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.workflow_id,
      row.employee_id,
      row.document_type,
      row.file_name,
      row.file_mime_type,
      row.file_data,
      row.extracted_fields,
      row.uploaded_at,
      row.uploaded_by,
    )
  return mapEmployeeDocument(row)
}

/** One row per document_type, latest upload wins — re-uploading the same type overwrites what HR/AI see, same pattern as employee_detail_submissions. */
export function listEmployeeDocumentsByWorkflow(workflowId: string): EmployeeDocument[] {
  const rows = getDb()
    .prepare(`SELECT ${EMPLOYEE_DOCUMENT_COLUMNS} FROM employee_documents WHERE workflow_id = ? ORDER BY uploaded_at`)
    .all(workflowId) as EmployeeDocumentRow[]
  const latestByType = new Map<string, EmployeeDocument>()
  for (const row of rows) latestByType.set(row.document_type, mapEmployeeDocument(row))
  return Array.from(latestByType.values())
}

// ---------- Document verification results ----------

export type DocumentVerificationResult = {
  id: string
  workflowId: string
  stepId: string
  overallStatus: string
  summary: string
  details: unknown
  runAt: string
  runBy: string
}

type DocumentVerificationResultRow = {
  id: string
  workflow_id: string
  step_id: string
  overall_status: string
  summary: string
  details: string
  run_at: string
  run_by: string
}

function mapDocumentVerificationResult(row: DocumentVerificationResultRow): DocumentVerificationResult {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    overallStatus: row.overall_status,
    summary: row.summary,
    details: JSON.parse(row.details),
    runAt: row.run_at,
    runBy: row.run_by,
  }
}

const DOCUMENT_VERIFICATION_RESULT_COLUMNS = 'id, workflow_id, step_id, overall_status, summary, details, run_at, run_by'

export function createDocumentVerificationResult(input: {
  workflowId: string
  stepId: string
  overallStatus: string
  summary: string
  details: unknown
  runBy: string
  runAt?: string
}): DocumentVerificationResult {
  const row: DocumentVerificationResultRow = {
    id: genId('docverify'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    overall_status: input.overallStatus,
    summary: input.summary,
    details: JSON.stringify(input.details),
    run_at: input.runAt ?? nowIso(),
    run_by: input.runBy,
  }
  getDb()
    .prepare(`INSERT INTO document_verification_results (${DOCUMENT_VERIFICATION_RESULT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.workflow_id, row.step_id, row.overall_status, row.summary, row.details, row.run_at, row.run_by)
  return mapDocumentVerificationResult(row)
}

/** Re-running the AI check inserts a new row rather than updating in place, so the latest run_at wins. */
export function getLatestDocumentVerificationResult(workflowId: string): DocumentVerificationResult | null {
  const row = getDb()
    .prepare(`SELECT ${DOCUMENT_VERIFICATION_RESULT_COLUMNS} FROM document_verification_results WHERE workflow_id = ? ORDER BY run_at DESC LIMIT 1`)
    .get(workflowId) as DocumentVerificationResultRow | undefined
  return row ? mapDocumentVerificationResult(row) : null
}

// ---------- HR approval: AI-generated profile entry ----------

export type HrApprovalProfileEntry = {
  id: string
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  documentId: string
  documentName: string
  generatedAt: string
  generatedBy: string
}

type HrApprovalProfileEntryRow = {
  id: string
  workflow_id: string
  step_id: string
  markdown: string
  summary: string
  document_id: string
  document_name: string
  generated_at: string
  generated_by: string
}

function mapHrApprovalProfileEntry(row: HrApprovalProfileEntryRow): HrApprovalProfileEntry {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    markdown: row.markdown,
    summary: row.summary,
    documentId: row.document_id,
    documentName: row.document_name,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  }
}

const HR_APPROVAL_PROFILE_ENTRY_COLUMNS =
  'id, workflow_id, step_id, markdown, summary, document_id, document_name, generated_at, generated_by'

export function createHrApprovalProfileEntry(input: {
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  documentId: string
  documentName: string
  generatedBy: string
  generatedAt?: string
}): HrApprovalProfileEntry {
  const row: HrApprovalProfileEntryRow = {
    id: genId('hrprofile'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    markdown: input.markdown,
    summary: input.summary,
    document_id: input.documentId,
    document_name: input.documentName,
    generated_at: input.generatedAt ?? nowIso(),
    generated_by: input.generatedBy,
  }
  getDb()
    .prepare(`INSERT INTO hr_approval_profile_entries (${HR_APPROVAL_PROFILE_ENTRY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.workflow_id,
      row.step_id,
      row.markdown,
      row.summary,
      row.document_id,
      row.document_name,
      row.generated_at,
      row.generated_by,
    )
  return mapHrApprovalProfileEntry(row)
}

/** Re-generating inserts a new row rather than updating in place (mirrors document verification
 * results), so the latest generated_at wins and older KB docs it produced aren't retracted. */
export function getLatestHrApprovalProfileEntry(workflowId: string): HrApprovalProfileEntry | null {
  const row = getDb()
    .prepare(
      `SELECT ${HR_APPROVAL_PROFILE_ENTRY_COLUMNS} FROM hr_approval_profile_entries WHERE workflow_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(workflowId) as HrApprovalProfileEntryRow | undefined
  return row ? mapHrApprovalProfileEntry(row) : null
}

// ---------- Manager approval: AI-generated team/date/role report ----------

export type ManagerApprovalReport = {
  id: string
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  teamName: string
  startDate: string
  roleTitle: string
  generatedAt: string
  generatedBy: string
}

type ManagerApprovalReportRow = {
  id: string
  workflow_id: string
  step_id: string
  markdown: string
  summary: string
  team_name: string
  start_date: string
  role_title: string
  generated_at: string
  generated_by: string
}

function mapManagerApprovalReport(row: ManagerApprovalReportRow): ManagerApprovalReport {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    markdown: row.markdown,
    summary: row.summary,
    teamName: row.team_name,
    startDate: row.start_date,
    roleTitle: row.role_title,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  }
}

const MANAGER_APPROVAL_REPORT_COLUMNS =
  'id, workflow_id, step_id, markdown, summary, team_name, start_date, role_title, generated_at, generated_by'

export function createManagerApprovalReport(input: {
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  teamName: string
  startDate: string
  roleTitle: string
  generatedBy: string
  generatedAt?: string
}): ManagerApprovalReport {
  const row: ManagerApprovalReportRow = {
    id: genId('mgrreport'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    markdown: input.markdown,
    summary: input.summary,
    team_name: input.teamName,
    start_date: input.startDate,
    role_title: input.roleTitle,
    generated_at: input.generatedAt ?? nowIso(),
    generated_by: input.generatedBy,
  }
  getDb()
    .prepare(`INSERT INTO manager_approval_reports (${MANAGER_APPROVAL_REPORT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      row.workflow_id,
      row.step_id,
      row.markdown,
      row.summary,
      row.team_name,
      row.start_date,
      row.role_title,
      row.generated_at,
      row.generated_by,
    )
  return mapManagerApprovalReport(row)
}

export function getLatestManagerApprovalReport(workflowId: string): ManagerApprovalReport | null {
  const row = getDb()
    .prepare(
      `SELECT ${MANAGER_APPROVAL_REPORT_COLUMNS} FROM manager_approval_reports WHERE workflow_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(workflowId) as ManagerApprovalReportRow | undefined
  return row ? mapManagerApprovalReport(row) : null
}

// ---------- IT account creation: AI-generated credentials summary ----------

export type ItAccountReport = {
  id: string
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  email: string
  generatedAt: string
  generatedBy: string
}

type ItAccountReportRow = {
  id: string
  workflow_id: string
  step_id: string
  markdown: string
  summary: string
  email: string
  generated_at: string
  generated_by: string
}

function mapItAccountReport(row: ItAccountReportRow): ItAccountReport {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    markdown: row.markdown,
    summary: row.summary,
    email: row.email,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  }
}

const IT_ACCOUNT_REPORT_COLUMNS = 'id, workflow_id, step_id, markdown, summary, email, generated_at, generated_by'

export function createItAccountReport(input: {
  workflowId: string
  stepId: string
  markdown: string
  summary: string
  email: string
  generatedBy: string
  generatedAt?: string
}): ItAccountReport {
  const row: ItAccountReportRow = {
    id: genId('itaccount'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    markdown: input.markdown,
    summary: input.summary,
    email: input.email,
    generated_at: input.generatedAt ?? nowIso(),
    generated_by: input.generatedBy,
  }
  getDb()
    .prepare(`INSERT INTO it_account_reports (${IT_ACCOUNT_REPORT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.workflow_id, row.step_id, row.markdown, row.summary, row.email, row.generated_at, row.generated_by)
  return mapItAccountReport(row)
}

export function getLatestItAccountReport(workflowId: string): ItAccountReport | null {
  const row = getDb()
    .prepare(
      `SELECT ${IT_ACCOUNT_REPORT_COLUMNS} FROM it_account_reports WHERE workflow_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(workflowId) as ItAccountReportRow | undefined
  return row ? mapItAccountReport(row) : null
}

// ---------- Asset allocation: AI-generated summary ----------
// asset_allocation has no subtask checklist — a single AI-generated plain-language summary of the
// standard asset kit (see lib/asset-allocation-report.ts), generated on Notify, that Diego reviews
// and approves with one button (see task-actions.ts).

export type AssetAllocationSummary = {
  id: string
  workflowId: string
  stepId: string
  approvalId: string
  summaryText: string
  generatedAt: string
}

type AssetAllocationSummaryRow = {
  id: string
  workflow_id: string
  step_id: string
  approval_id: string
  summary_text: string
  generated_at: string
}

function mapAssetAllocationSummary(row: AssetAllocationSummaryRow): AssetAllocationSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    approvalId: row.approval_id,
    summaryText: row.summary_text,
    generatedAt: row.generated_at,
  }
}

const ASSET_ALLOCATION_SUMMARY_COLUMNS = 'id, workflow_id, step_id, approval_id, summary_text, generated_at'

export function createAssetAllocationSummary(input: {
  workflowId: string
  stepId: string
  approvalId: string
  summaryText: string
  generatedAt?: string
}): AssetAllocationSummary {
  const row: AssetAllocationSummaryRow = {
    id: genId('assetsummary'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    approval_id: input.approvalId,
    summary_text: input.summaryText,
    generated_at: input.generatedAt ?? nowIso(),
  }
  getDb()
    .prepare(`INSERT INTO asset_allocation_summaries (${ASSET_ALLOCATION_SUMMARY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.workflow_id, row.step_id, row.approval_id, row.summary_text, row.generated_at)
  return mapAssetAllocationSummary(row)
}

export function getLatestAssetAllocationSummary(workflowId: string): AssetAllocationSummary | null {
  const row = getDb()
    .prepare(
      `SELECT ${ASSET_ALLOCATION_SUMMARY_COLUMNS} FROM asset_allocation_summaries WHERE workflow_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(workflowId) as AssetAllocationSummaryRow | undefined
  return row ? mapAssetAllocationSummary(row) : null
}

// ---------- IT verification: AI-generated summary ----------
// it_verification has no subtask checklist either — a single AI-generated confirmation summary
// (see lib/it-verification-report.ts) that only exists once it_account_creation AND
// asset_allocation are both verified, reviewed and approved by Diego with one button, same shape
// as asset_allocation above.

export type ItVerificationSummary = {
  id: string
  workflowId: string
  stepId: string
  approvalId: string
  summaryText: string
  generatedAt: string
}

type ItVerificationSummaryRow = {
  id: string
  workflow_id: string
  step_id: string
  approval_id: string
  summary_text: string
  generated_at: string
}

function mapItVerificationSummary(row: ItVerificationSummaryRow): ItVerificationSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    approvalId: row.approval_id,
    summaryText: row.summary_text,
    generatedAt: row.generated_at,
  }
}

const IT_VERIFICATION_SUMMARY_COLUMNS = 'id, workflow_id, step_id, approval_id, summary_text, generated_at'

export function createItVerificationSummary(input: {
  workflowId: string
  stepId: string
  approvalId: string
  summaryText: string
  generatedAt?: string
}): ItVerificationSummary {
  const row: ItVerificationSummaryRow = {
    id: genId('itverifysummary'),
    workflow_id: input.workflowId,
    step_id: input.stepId,
    approval_id: input.approvalId,
    summary_text: input.summaryText,
    generated_at: input.generatedAt ?? nowIso(),
  }
  getDb()
    .prepare(`INSERT INTO it_verification_summaries (${IT_VERIFICATION_SUMMARY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.workflow_id, row.step_id, row.approval_id, row.summary_text, row.generated_at)
  return mapItVerificationSummary(row)
}

export function getLatestItVerificationSummary(workflowId: string): ItVerificationSummary | null {
  const row = getDb()
    .prepare(
      `SELECT ${IT_VERIFICATION_SUMMARY_COLUMNS} FROM it_verification_summaries WHERE workflow_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(workflowId) as ItVerificationSummaryRow | undefined
  return row ? mapItVerificationSummary(row) : null
}

// ---------- Dev-only step reset ----------
// Everything below exists solely to power the dev/testing "reset last completed step" control —
// never called in production. Deletes are targeted at a single workflow, never cross-workflow.

/** Approvals are referenced by notifications, subtasks, and the two AI-summary tables (all NOT
 * NULL foreign keys) — node's sqlite enforces foreign keys by default, so those child rows must
 * go first or the approval delete below throws a constraint violation. Scoped the same way as the
 * approval delete itself: only rows tied to this workflow+step's approvals, never cross-workflow. */
export function deleteApprovalsForStep(workflowId: string, stepId: string) {
  const db = getDb()
  const approvalSubquery = 'SELECT id FROM approvals WHERE workflow_id = ? AND step_id = ?'
  db.prepare(`DELETE FROM notifications WHERE approval_id IN (${approvalSubquery})`).run(workflowId, stepId)
  db.prepare(`DELETE FROM subtasks WHERE approval_id IN (${approvalSubquery})`).run(workflowId, stepId)
  db.prepare(`DELETE FROM asset_allocation_summaries WHERE approval_id IN (${approvalSubquery})`).run(workflowId, stepId)
  db.prepare(`DELETE FROM it_verification_summaries WHERE approval_id IN (${approvalSubquery})`).run(workflowId, stepId)
  db.prepare('DELETE FROM approvals WHERE workflow_id = ? AND step_id = ?').run(workflowId, stepId)
}

export function deleteEmployeeDetailSubmissionsForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM employee_detail_submissions WHERE workflow_id = ?').run(workflowId)
}

export function deleteEmployeeDocumentsForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM employee_documents WHERE workflow_id = ?').run(workflowId)
}

export function deleteDocumentVerificationResultsForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM document_verification_results WHERE workflow_id = ?').run(workflowId)
}

export function deleteHrApprovalProfileEntriesForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM hr_approval_profile_entries WHERE workflow_id = ?').run(workflowId)
}

export function deleteManagerApprovalReportsForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM manager_approval_reports WHERE workflow_id = ?').run(workflowId)
}

export function deleteItAccountReportsForWorkflow(workflowId: string) {
  getDb().prepare('DELETE FROM it_account_reports WHERE workflow_id = ?').run(workflowId)
}

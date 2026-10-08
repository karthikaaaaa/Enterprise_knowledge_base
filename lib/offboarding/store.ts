import crypto from 'node:crypto'
import { getDb } from '@/lib/workflow-store'

/**
 * Offboarding's own tables, on the shared workflows.db connection (so runInTransaction covers them).
 * Everything here is soft: rows are archived / reverted / voided, never deleted, so Revert can put
 * every change back. The schema is created lazily on first use.
 */

let schemaReady = false

function db() {
  const database = getDb()
  if (schemaReady) return database
  database.exec(`
    -- Step 1: how and when the employee is leaving.
    CREATE TABLE IF NOT EXISTS offboarding_exit_details (
      workflow_id TEXT PRIMARY KEY REFERENCES workflows(id),
      exit_type TEXT NOT NULL CHECK (exit_type IN ('resignation', 'termination', 'not_recorded')),
      last_working_day TEXT,
      reason TEXT,
      recorded_by TEXT REFERENCES users(id),
      recorded_at TEXT NOT NULL
    );

    -- Approve / send-back decisions on non-AI steps (manager exit approval, HR exit approval,
    -- knowledge-transfer acceptance). reverted_at is set when a Revert undoes the step.
    CREATE TABLE IF NOT EXISTS offboarding_decisions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_key TEXT NOT NULL,
      approval_id TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'sent_back')),
      comment TEXT,
      decided_by TEXT NOT NULL REFERENCES users(id),
      decided_at TEXT NOT NULL,
      reverted_at TEXT
    );

    -- Step 4: the AI-drafted handover and its items.
    CREATE TABLE IF NOT EXISTS handover_plans (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      draft_notes TEXT NOT NULL,
      employee_notes TEXT,
      employee_confirmed_at TEXT,
      manager_accepted_at TEXT,
      manager_accepted_by TEXT,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS handover_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES handover_plans(id),
      item_type TEXT NOT NULL,
      item_ref TEXT NOT NULL,
      item_label TEXT NOT NULL,
      current_owner TEXT NOT NULL,
      new_owner TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ownership_transfers (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      item_type TEXT NOT NULL,
      item_ref TEXT NOT NULL,
      item_label TEXT NOT NULL,
      old_owner TEXT NOT NULL,
      new_owner TEXT NOT NULL,
      transferred_by TEXT NOT NULL,
      transferred_at TEXT NOT NULL,
      reverted_at TEXT
    );

    -- Step 5: every access action, one live row per (workflow, system, target) so re-runs never
    -- double-revoke. status 'reverted' once Revert has restored it.
    CREATE TABLE IF NOT EXISTS access_actions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      system TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      description TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('revoked', 'scheduled', 'deactivated')),
      external_ref TEXT,
      effective_date TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'reverted')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      reverted_at TEXT,
      UNIQUE (workflow_id, system, target_ref)
    );

    -- The mock external directory (SSO / email) — stands in for a real IdP/mail admin API.
    CREATE TABLE IF NOT EXISTS directory_tickets (
      id TEXT PRIMARY KEY,
      system TEXT NOT NULL,
      account TEXT NOT NULL,
      action TEXT NOT NULL,
      effective_date TEXT,
      status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Step 6: one return line per asset, with the asset's prior status kept for Revert.
    CREATE TABLE IF NOT EXISTS asset_return_items (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      asset_id TEXT NOT NULL REFERENCES assets(id),
      asset_name TEXT NOT NULL,
      asset_type TEXT,
      serial_number TEXT,
      prior_status TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'returned', 'missing')),
      condition_notes TEXT,
      marked_by TEXT,
      marked_at TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE (workflow_id, asset_id)
    );

    -- Step 7: one settlement statement per workflow (upserted, voided on Revert).
    CREATE TABLE IF NOT EXISTS settlement_statements (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id),
      statement_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      voided_at TEXT
    );

    -- Audit trail for offboarding actions that aren't reverts (exit completed, ownership
    -- transfers, access changes). Reverts stay in workflow_audit_log.
    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      step_key TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      performed_by TEXT,
      performed_at TEXT NOT NULL
    );
  `)
  // Exit-details columns added for "Request details from employee" (lib/offboarding/exit-info-requests.ts).
  // field_sources holds, per field, who supplied the current value: { source, by, at }.
  for (const ddl of [
    'ALTER TABLE offboarding_exit_details ADD COLUMN notice_start_date TEXT',
    'ALTER TABLE offboarding_exit_details ADD COLUMN forwarding_contact TEXT',
    'ALTER TABLE offboarding_exit_details ADD COLUMN lwd_confirmed_by TEXT',
    'ALTER TABLE offboarding_exit_details ADD COLUMN lwd_confirmed_at TEXT',
    "ALTER TABLE offboarding_exit_details ADD COLUMN field_sources TEXT NOT NULL DEFAULT '{}'",
  ]) {
    try {
      database.exec(ddl)
    } catch {
      // Column already exists.
    }
  }
  schemaReady = true
  return database
}

export function genId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

export function nowIso() {
  return new Date().toISOString()
}

// ---------- Exit details ----------

export type ExitType = 'resignation' | 'termination' | 'not_recorded'
export type ExitFieldSource = { source: 'employee' | 'hr' | 'system'; by: string | null; at: string }
export type ExitDetailsField = 'exitType' | 'reason' | 'lastWorkingDay' | 'noticeStartDate' | 'forwardingContact'
export type ExitDetails = {
  workflowId: string
  exitType: ExitType
  lastWorkingDay: string | null
  reason: string | null
  noticeStartDate: string | null
  forwardingContact: string | null
  /** Set when HR explicitly confirms the last working day (cleared whenever the date changes). */
  lwdConfirmedBy: string | null
  lwdConfirmedAt: string | null
  /** Where each field's current value came from. Fields never set have no entry. */
  sources: Partial<Record<ExitDetailsField, ExitFieldSource>>
  recordedBy: string | null
  recordedAt: string
}

const EXIT_FIELD_COLUMNS: Record<ExitDetailsField, string> = {
  exitType: 'exit_type',
  reason: 'reason',
  lastWorkingDay: 'last_working_day',
  noticeStartDate: 'notice_start_date',
  forwardingContact: 'forwarding_contact',
}

export function getExitDetails(workflowId: string): ExitDetails | null {
  const row = db().prepare('SELECT * FROM offboarding_exit_details WHERE workflow_id = ?').get(workflowId) as Record<string, string | null> | undefined
  if (!row) return null
  let sources: ExitDetails['sources'] = {}
  try {
    sources = JSON.parse(row.field_sources ?? '{}')
  } catch {
    sources = {}
  }
  return {
    workflowId,
    exitType: row.exit_type as ExitType,
    lastWorkingDay: row.last_working_day,
    reason: row.reason,
    noticeStartDate: row.notice_start_date ?? null,
    forwardingContact: row.forwarding_contact ?? null,
    lwdConfirmedBy: row.lwd_confirmed_by ?? null,
    lwdConfirmedAt: row.lwd_confirmed_at ?? null,
    sources,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at as string,
  }
}

/** Creates the record if missing (the system backfill — see exitDetailsFor). Never overwrites. */
export function ensureExitDetails(input: { workflowId: string; lastWorkingDay: string | null }) {
  const existing = getExitDetails(input.workflowId)
  if (existing) return existing
  const now = nowIso()
  const sources: ExitDetails['sources'] = input.lastWorkingDay ? { lastWorkingDay: { source: 'system', by: null, at: now } } : {}
  db()
    .prepare("INSERT INTO offboarding_exit_details (workflow_id, exit_type, last_working_day, reason, recorded_by, recorded_at, field_sources) VALUES (?, 'not_recorded', ?, NULL, NULL, ?, ?)")
    .run(input.workflowId, input.lastWorkingDay, now, JSON.stringify(sources))
  return getExitDetails(input.workflowId)!
}

export type ExitDetailChange = { field: ExitDetailsField; old: string | null; new: string | null }

/**
 * Writes the given fields and logs one workflow event per field that actually changed (who, when,
 * old → new, source) — the exit-details audit trail. Changing the last working day drops HR's
 * confirmation; `confirmLastWorkingDay` (HR only) sets it. Returns the changes made.
 */
export function applyExitDetailChanges(
  workflowId: string,
  changes: Partial<Record<ExitDetailsField, string | null>>,
  actor: { source: 'employee' | 'hr'; userId: string },
  options: { confirmLastWorkingDay?: boolean } = {},
): ExitDetailChange[] {
  const current = getExitDetails(workflowId) ?? ensureExitDetails({ workflowId, lastWorkingDay: null })
  const now = nowIso()
  const made: ExitDetailChange[] = []
  const sources = { ...current.sources }
  for (const [field, value] of Object.entries(changes) as [ExitDetailsField, string | null][]) {
    if (value === undefined) continue
    const old = current[field] as string | null
    if (old === value) continue
    db().prepare(`UPDATE offboarding_exit_details SET ${EXIT_FIELD_COLUMNS[field]} = ? WHERE workflow_id = ?`).run(value, workflowId)
    sources[field] = { source: actor.source, by: actor.userId, at: now }
    made.push({ field, old, new: value })
  }
  const lwdChanged = made.some((c) => c.field === 'lastWorkingDay')
  if (lwdChanged) db().prepare('UPDATE offboarding_exit_details SET lwd_confirmed_by = NULL, lwd_confirmed_at = NULL WHERE workflow_id = ?').run(workflowId)
  const confirm = options.confirmLastWorkingDay && actor.source === 'hr'
  if (confirm) db().prepare('UPDATE offboarding_exit_details SET lwd_confirmed_by = ?, lwd_confirmed_at = ? WHERE workflow_id = ?').run(actor.userId, now, workflowId)
  db()
    .prepare('UPDATE offboarding_exit_details SET field_sources = ?, recorded_by = ?, recorded_at = ? WHERE workflow_id = ?')
    .run(JSON.stringify(sources), actor.userId, now, workflowId)

  for (const change of made) {
    recordWorkflowEvent({ workflowId, stepKey: 'exit_details', action: 'exit_detail_changed', detail: { ...change, source: actor.source }, performedBy: actor.userId })
  }
  if (confirm && (lwdChanged || !current.lwdConfirmedAt)) {
    recordWorkflowEvent({
      workflowId,
      stepKey: 'exit_details',
      action: 'last_working_day_confirmed',
      detail: { lastWorkingDay: getExitDetails(workflowId)!.lastWorkingDay },
      performedBy: actor.userId,
    })
  }
  return made
}

/** Exit Initiated revert: back to "nothing recorded yet". The old values go into the audit event
 * first, so nothing is lost from the trail. */
export function clearExitDetails(workflowId: string, performedBy: string) {
  const current = getExitDetails(workflowId)
  if (!current) return
  recordWorkflowEvent({ workflowId, stepKey: 'exit_details', action: 'exit_details_cleared', detail: { previous: { ...current, sources: undefined } }, performedBy })
  db().prepare('DELETE FROM offboarding_exit_details WHERE workflow_id = ?').run(workflowId)
}

// ---------- Decisions ----------

export type Decision = { id: string; stepKey: string; approvalId: string | null; decision: 'approved' | 'sent_back'; comment: string | null; decidedBy: string; decidedAt: string }

export function recordDecision(input: Omit<Decision, 'id' | 'decidedAt'> & { workflowId: string }) {
  const id = genId('decision')
  db()
    .prepare('INSERT INTO offboarding_decisions (id, workflow_id, step_key, approval_id, decision, comment, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.workflowId, input.stepKey, input.approvalId, input.decision, input.comment, input.decidedBy, nowIso())
  return id
}

/** Latest non-reverted decision for a step. */
export function getLatestDecision(workflowId: string, stepKey: string): Decision | null {
  const row = db()
    .prepare('SELECT * FROM offboarding_decisions WHERE workflow_id = ? AND step_key = ? AND reverted_at IS NULL ORDER BY decided_at DESC, rowid DESC LIMIT 1')
    .get(workflowId, stepKey) as Record<string, string | null> | undefined
  return row
    ? {
        id: row.id as string,
        stepKey: row.step_key as string,
        approvalId: row.approval_id,
        decision: row.decision as Decision['decision'],
        comment: row.comment,
        decidedBy: row.decided_by as string,
        decidedAt: row.decided_at as string,
      }
    : null
}

export function revertDecisions(workflowId: string, stepKey: string) {
  db().prepare('UPDATE offboarding_decisions SET reverted_at = ? WHERE workflow_id = ? AND step_key = ? AND reverted_at IS NULL').run(nowIso(), workflowId, stepKey)
}

// ---------- Handover ----------

export type HandoverItem = { id: string; itemType: string; itemRef: string; itemLabel: string; currentOwner: string; newOwner: string }
export type HandoverPlan = {
  id: string
  workflowId: string
  draftNotes: string
  employeeNotes: string | null
  employeeConfirmedAt: string | null
  managerAcceptedAt: string | null
  managerAcceptedBy: string | null
  model: string
  generatedAt: string
  items: HandoverItem[]
}

export function getActiveHandoverPlan(workflowId: string): HandoverPlan | null {
  const row = db()
    .prepare('SELECT * FROM handover_plans WHERE workflow_id = ? AND archived_at IS NULL ORDER BY generated_at DESC LIMIT 1')
    .get(workflowId) as Record<string, string | null> | undefined
  if (!row) return null
  const items = db().prepare('SELECT * FROM handover_items WHERE plan_id = ? ORDER BY rowid').all(row.id) as Record<string, string>[]
  return {
    id: row.id as string,
    workflowId,
    draftNotes: row.draft_notes as string,
    employeeNotes: row.employee_notes,
    employeeConfirmedAt: row.employee_confirmed_at,
    managerAcceptedAt: row.manager_accepted_at,
    managerAcceptedBy: row.manager_accepted_by,
    model: row.model as string,
    generatedAt: row.generated_at as string,
    items: items.map((i) => ({ id: i.id, itemType: i.item_type, itemRef: i.item_ref, itemLabel: i.item_label, currentOwner: i.current_owner, newOwner: i.new_owner })),
  }
}

export function createHandoverPlan(input: { workflowId: string; draftNotes: string; model: string; items: Omit<HandoverItem, 'id'>[] }) {
  const id = genId('handover')
  db().prepare('INSERT INTO handover_plans (id, workflow_id, draft_notes, model, generated_at) VALUES (?, ?, ?, ?, ?)').run(id, input.workflowId, input.draftNotes, input.model, nowIso())
  const insert = db().prepare('INSERT INTO handover_items (id, plan_id, item_type, item_ref, item_label, current_owner, new_owner) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const item of input.items) insert.run(genId('hoitem'), id, item.itemType, item.itemRef, item.itemLabel, item.currentOwner, item.newOwner)
  return getActiveHandoverPlan(input.workflowId)!
}

export function confirmHandoverByEmployee(planId: string, notes: string) {
  db().prepare('UPDATE handover_plans SET employee_notes = ?, employee_confirmed_at = ? WHERE id = ?').run(notes, nowIso(), planId)
}

export function acceptHandoverByManager(planId: string, userId: string) {
  db().prepare('UPDATE handover_plans SET manager_accepted_at = ?, manager_accepted_by = ? WHERE id = ?').run(nowIso(), userId, planId)
}

export function archiveHandoverPlans(workflowId: string) {
  db().prepare('UPDATE handover_plans SET archived_at = ? WHERE workflow_id = ? AND archived_at IS NULL').run(nowIso(), workflowId)
}

export type OwnershipTransfer = { id: string; itemType: string; itemRef: string; itemLabel: string; oldOwner: string; newOwner: string; transferredBy: string; transferredAt: string; revertedAt: string | null }

export function recordOwnershipTransfer(input: Omit<OwnershipTransfer, 'id' | 'transferredAt' | 'revertedAt'> & { workflowId: string }) {
  db()
    .prepare('INSERT INTO ownership_transfers (id, workflow_id, item_type, item_ref, item_label, old_owner, new_owner, transferred_by, transferred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(genId('transfer'), input.workflowId, input.itemType, input.itemRef, input.itemLabel, input.oldOwner, input.newOwner, input.transferredBy, nowIso())
}

export function listOwnershipTransfers(workflowId: string, includeReverted = true): OwnershipTransfer[] {
  const rows = db()
    .prepare(`SELECT * FROM ownership_transfers WHERE workflow_id = ? ${includeReverted ? '' : 'AND reverted_at IS NULL'} ORDER BY transferred_at, rowid`)
    .all(workflowId) as Record<string, string | null>[]
  return rows.map((r) => ({
    id: r.id as string,
    itemType: r.item_type as string,
    itemRef: r.item_ref as string,
    itemLabel: r.item_label as string,
    oldOwner: r.old_owner as string,
    newOwner: r.new_owner as string,
    transferredBy: r.transferred_by as string,
    transferredAt: r.transferred_at as string,
    revertedAt: r.reverted_at,
  }))
}

export function markTransfersReverted(workflowId: string) {
  db().prepare('UPDATE ownership_transfers SET reverted_at = ? WHERE workflow_id = ? AND reverted_at IS NULL').run(nowIso(), workflowId)
}

// ---------- Access actions + mock directory ----------

export type AccessAction = {
  id: string
  workflowId: string
  system: string
  targetRef: string
  description: string
  action: 'revoked' | 'scheduled' | 'deactivated'
  externalRef: string | null
  effectiveDate: string | null
  status: 'active' | 'reverted'
  createdAt: string
  revertedAt: string | null
}

function mapAccessAction(r: Record<string, string | null>): AccessAction {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    system: r.system as string,
    targetRef: r.target_ref as string,
    description: r.description as string,
    action: r.action as AccessAction['action'],
    externalRef: r.external_ref,
    effectiveDate: r.effective_date,
    status: r.status as AccessAction['status'],
    createdAt: r.created_at as string,
    revertedAt: r.reverted_at,
  }
}

export function getAccessAction(workflowId: string, system: string, targetRef: string): AccessAction | null {
  const row = db().prepare('SELECT * FROM access_actions WHERE workflow_id = ? AND system = ? AND target_ref = ?').get(workflowId, system, targetRef) as
    | Record<string, string | null>
    | undefined
  return row ? mapAccessAction(row) : null
}

/** Idempotent: an active row is left alone; a reverted one is re-activated in place. */
export function upsertAccessAction(input: Omit<AccessAction, 'id' | 'status' | 'createdAt' | 'revertedAt'> & { createdBy: string | null }) {
  const existing = getAccessAction(input.workflowId, input.system, input.targetRef)
  if (existing?.status === 'active') return { action: existing, created: false }
  if (existing) {
    db()
      .prepare("UPDATE access_actions SET status = 'active', reverted_at = NULL, action = ?, external_ref = ?, effective_date = ?, description = ?, created_at = ?, created_by = ? WHERE id = ?")
      .run(input.action, input.externalRef, input.effectiveDate, input.description, nowIso(), input.createdBy, existing.id)
  } else {
    db()
      .prepare(
        "INSERT INTO access_actions (id, workflow_id, system, target_ref, description, action, external_ref, effective_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      )
      .run(genId('access'), input.workflowId, input.system, input.targetRef, input.description, input.action, input.externalRef, input.effectiveDate, input.createdBy, nowIso())
  }
  return { action: getAccessAction(input.workflowId, input.system, input.targetRef)!, created: true }
}

export function listAccessActions(workflowId: string, onlyActive = false): AccessAction[] {
  const rows = db()
    .prepare(`SELECT * FROM access_actions WHERE workflow_id = ? ${onlyActive ? "AND status = 'active'" : ''} ORDER BY created_at, rowid`)
    .all(workflowId) as Record<string, string | null>[]
  return rows.map(mapAccessAction)
}

export function revertAccessAction(id: string) {
  db().prepare("UPDATE access_actions SET status = 'reverted', reverted_at = ? WHERE id = ?").run(nowIso(), id)
}

/** Is there an active KB department-visibility restriction on any of this employee's workflows? */
export function hasActiveKbRestriction(workflowIds: string[]): boolean {
  if (workflowIds.length === 0) return false
  const placeholders = workflowIds.map(() => '?').join(', ')
  const row = db()
    .prepare(`SELECT 1 FROM access_actions WHERE system = 'kb_department_visibility' AND status = 'active' AND workflow_id IN (${placeholders}) LIMIT 1`)
    .get(...workflowIds)
  return !!row
}

export type DirectoryTicket = { id: string; system: string; account: string; action: string; effectiveDate: string | null; status: 'scheduled' | 'completed' | 'cancelled' }

export function createDirectoryTicket(input: Omit<DirectoryTicket, 'id' | 'status'>): DirectoryTicket {
  const id = genId('dirticket')
  const now = nowIso()
  db()
    .prepare("INSERT INTO directory_tickets (id, system, account, action, effective_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)")
    .run(id, input.system, input.account, input.action, input.effectiveDate, now, now)
  return getDirectoryTicket(id)!
}

export function getDirectoryTicket(id: string): DirectoryTicket | null {
  const r = db().prepare('SELECT * FROM directory_tickets WHERE id = ?').get(id) as Record<string, string | null> | undefined
  return r
    ? { id: r.id as string, system: r.system as string, account: r.account as string, action: r.action as string, effectiveDate: r.effective_date, status: r.status as DirectoryTicket['status'] }
    : null
}

export function setDirectoryTicketStatus(id: string, status: DirectoryTicket['status']) {
  db().prepare('UPDATE directory_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id)
}

// ---------- KB grants / payroll / expense (soft end + restore on existing onboarding tables) ----------

export function listActiveKbGrantIds(employeeId: string): { id: string; categories: string[] }[] {
  const rows = db().prepare('SELECT id, categories FROM employee_kb_grants WHERE employee_id = ? AND revoked_at IS NULL').all(employeeId) as { id: string; categories: string }[]
  return rows.map((r) => ({ id: r.id, categories: JSON.parse(r.categories) }))
}

export function revokeKbGrant(grantId: string, workflowId: string) {
  db().prepare('UPDATE employee_kb_grants SET revoked_at = ?, revoked_by_workflow_id = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), workflowId, grantId)
}

export function restoreKbGrantsRevokedBy(workflowId: string) {
  db().prepare('UPDATE employee_kb_grants SET revoked_at = NULL, revoked_by_workflow_id = NULL WHERE revoked_by_workflow_id = ?').run(workflowId)
}

export type EndableRecord = { id: string; workflowId: string; label: string; endedAt: string | null; endedByWorkflowId: string | null }

/** Payroll entries + expense accounts created for this employee (by any onboarding workflow). */
export function listFinanceRecordsForEmployee(employeeId: string): { payroll: (EndableRecord & { annualSalary: number; currency: string; payFrequency: string })[]; expense: EndableRecord[] } {
  const payroll = db().prepare('SELECT * FROM payroll_records WHERE employee_id = ?').all(employeeId) as Record<string, string | number | null>[]
  const expense = db().prepare('SELECT * FROM expense_accounts WHERE employee_id = ?').all(employeeId) as Record<string, string | null>[]
  return {
    payroll: payroll.map((r) => ({
      id: r.id as string,
      workflowId: r.workflow_id as string,
      label: `Payroll entry (${r.pay_frequency})`,
      endedAt: (r.ended_at as string | null) ?? null,
      endedByWorkflowId: (r.ended_by_workflow_id as string | null) ?? null,
      annualSalary: Number(r.annual_salary),
      currency: r.currency as string,
      payFrequency: r.pay_frequency as string,
    })),
    expense: expense.map((r) => ({
      id: r.id as string,
      workflowId: r.workflow_id as string,
      label: `Expense account (cost centre ${r.cost_center})`,
      endedAt: r.ended_at ?? null,
      endedByWorkflowId: r.ended_by_workflow_id ?? null,
    })),
  }
}

export function endFinanceRecord(table: 'payroll_records' | 'expense_accounts', id: string, endDate: string, workflowId: string) {
  db().prepare(`UPDATE ${table} SET ended_at = ?, ended_by_workflow_id = ? WHERE id = ? AND ended_at IS NULL`).run(endDate, workflowId, id)
}

export function restoreFinanceRecordsEndedBy(workflowId: string) {
  db().prepare('UPDATE payroll_records SET ended_at = NULL, ended_by_workflow_id = NULL WHERE ended_by_workflow_id = ?').run(workflowId)
  db().prepare('UPDATE expense_accounts SET ended_at = NULL, ended_by_workflow_id = NULL WHERE ended_by_workflow_id = ?').run(workflowId)
}

// ---------- Assets ----------

export type AssetReturnItem = {
  id: string
  assetId: string
  assetName: string
  assetType: string | null
  serialNumber: string | null
  priorStatus: string | null
  status: 'pending' | 'returned' | 'missing'
  conditionNotes: string | null
  markedBy: string | null
  markedAt: string | null
}

export function listAssetReturnItems(workflowId: string): AssetReturnItem[] {
  const rows = db().prepare('SELECT * FROM asset_return_items WHERE workflow_id = ? AND archived_at IS NULL ORDER BY rowid').all(workflowId) as Record<string, string | null>[]
  return rows.map((r) => ({
    id: r.id as string,
    assetId: r.asset_id as string,
    assetName: r.asset_name as string,
    assetType: r.asset_type,
    serialNumber: r.serial_number,
    priorStatus: r.prior_status,
    status: r.status as AssetReturnItem['status'],
    conditionNotes: r.condition_notes,
    markedBy: r.marked_by,
    markedAt: r.marked_at,
  }))
}

/** Idempotent per (workflow, asset): an archived line is revived in place, a live one is kept. */
export function ensureAssetReturnItem(workflowId: string, asset: { id: string; name: string; assetType: string | null; serialNumber: string | null; status: string | null }) {
  const existing = db().prepare('SELECT id, archived_at FROM asset_return_items WHERE workflow_id = ? AND asset_id = ?').get(workflowId, asset.id) as
    | { id: string; archived_at: string | null }
    | undefined
  if (existing && !existing.archived_at) return false
  if (existing) {
    db()
      .prepare("UPDATE asset_return_items SET archived_at = NULL, status = 'pending', condition_notes = NULL, marked_by = NULL, marked_at = NULL, prior_status = ? WHERE id = ?")
      .run(asset.status, existing.id)
    return true
  }
  db()
    .prepare("INSERT INTO asset_return_items (id, workflow_id, asset_id, asset_name, asset_type, serial_number, prior_status, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .run(genId('assetreturn'), workflowId, asset.id, asset.name, asset.assetType, asset.serialNumber, asset.status, nowIso())
  return true
}

export function markAssetReturnItem(id: string, status: 'returned' | 'missing', notes: string | null, userId: string) {
  db().prepare('UPDATE asset_return_items SET status = ?, condition_notes = ?, marked_by = ?, marked_at = ? WHERE id = ?').run(status, notes, userId, nowIso(), id)
}

export function setAssetStatus(assetId: string, status: string | null) {
  db().prepare('UPDATE assets SET status = ? WHERE id = ?').run(status, assetId)
}

export function archiveAssetReturnItems(workflowId: string) {
  db().prepare('UPDATE asset_return_items SET archived_at = ? WHERE workflow_id = ? AND archived_at IS NULL').run(nowIso(), workflowId)
}

// ---------- Settlement ----------

export type SettlementStatement = { id: string; workflowId: string; statement: Record<string, unknown>; createdAt: string; updatedAt: string; voidedAt: string | null }

export function getSettlementStatement(workflowId: string, includeVoided = false): SettlementStatement | null {
  const r = db().prepare('SELECT * FROM settlement_statements WHERE workflow_id = ?').get(workflowId) as Record<string, string | null> | undefined
  if (!r || (!includeVoided && r.voided_at)) return null
  return { id: r.id as string, workflowId, statement: JSON.parse(r.statement_json as string), createdAt: r.created_at as string, updatedAt: r.updated_at as string, voidedAt: r.voided_at }
}

/** One statement per workflow: re-running updates it in place (and un-voids it), never duplicates. */
export function upsertSettlementStatement(workflowId: string, statement: Record<string, unknown>) {
  const existing = getSettlementStatement(workflowId, true)
  if (existing) {
    db().prepare('UPDATE settlement_statements SET statement_json = ?, updated_at = ?, voided_at = NULL WHERE id = ?').run(JSON.stringify(statement), nowIso(), existing.id)
  } else {
    const now = nowIso()
    db().prepare('INSERT INTO settlement_statements (id, workflow_id, statement_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(genId('settlement'), workflowId, JSON.stringify(statement), now, now)
  }
  return getSettlementStatement(workflowId)!
}

export function voidSettlementStatement(workflowId: string) {
  db().prepare('UPDATE settlement_statements SET voided_at = ? WHERE workflow_id = ? AND voided_at IS NULL').run(nowIso(), workflowId)
}

// ---------- Events ----------

export function recordWorkflowEvent(input: { workflowId: string; stepKey: string; action: string; detail: Record<string, unknown>; performedBy: string | null }) {
  db()
    .prepare('INSERT INTO workflow_events (id, workflow_id, step_key, action, detail_json, performed_by, performed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(genId('event'), input.workflowId, input.stepKey, input.action, JSON.stringify(input.detail), input.performedBy, nowIso())
}

export function listWorkflowEvents(workflowId: string) {
  const rows = db().prepare('SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY performed_at, rowid').all(workflowId) as Record<string, string | null>[]
  return rows.map((r) => ({ stepKey: r.step_key as string, action: r.action as string, detail: JSON.parse(r.detail_json as string), performedBy: r.performed_by, performedAt: r.performed_at as string }))
}

// ---------- Employees ----------

export function setEmployeeManager(employeeId: string, managerEmployeeId: string | null) {
  db().prepare('UPDATE employees SET manager_id = ? WHERE id = ?').run(managerEmployeeId, employeeId)
}

// ---------- Exit-details requests (employee_info_requests, step_key 'hr_exit_approval') ----------

/** Exit Initiated revert: an open "HR needs a few details" request no longer applies — withdraw it
 * (the request and its answer stay in the workflow events trail). Returns how many were withdrawn. */
export function withdrawOpenExitDetailRequests(workflowId: string): number {
  return Number(
    db().prepare("DELETE FROM employee_info_requests WHERE workflow_id = ? AND step_key = 'hr_exit_approval' AND status = 'open'").run(workflowId).changes,
  )
}

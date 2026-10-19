import {
  getDb,
  getUserById,
  listWorkflowsByEmployee,
  listEmployeeDocumentsByWorkflow,
  type User,
} from '@/lib/workflow-store'
import {
  runAiVerification,
  type AiLogEvidence,
  type AiLogFacts,
  type AiLogTaskFacts,
  type AiVerificationLog,
  type AiVerificationStepConfig,
  type NarrativeGenerator,
} from '@/lib/ai-verification-log'
import { CONFIDENTIALITY_AGREEMENT_VERSION } from '@/lib/legal-agreement-template'
import {
  loadOffboarding,
  exitDetailsFor,
  resolveManagerUser,
  utcStamp,
  HANDOVER_CATEGORIES,
  type OffboardingContext,
} from '@/lib/offboarding/context'
import {
  getLatestDecision,
  getAccessAction,
  upsertAccessAction,
  listAccessActions,
  listActiveKbGrantIds,
  revokeKbGrant,
  listFinanceRecordsForEmployee,
  endFinanceRecord,
  listAssetReturnItems,
  upsertSettlementStatement,
  getSettlementStatement,
  listWorkflowEvents,
  type ExitDetails,
} from '@/lib/offboarding/store'
import { directoryService } from '@/lib/offboarding/directory-service'
import { EXIT_DETAIL_FIELDS, EXIT_TYPE_MISSING_LABEL } from '@/lib/offboarding/exit-detail-fields'

/**
 * The four AI-automated offboarding steps, on the shared structured-review contract
 * (lib/ai-verification-log.ts): code performs the step's actions (idempotently) and computes every
 * status / evidence row from records; the model only writes the HR summary and recommendations.
 *   hr_exit_approval       — HR's pre-check before approving the exit
 *   it_access_deactivation — revoke KB access, schedule SSO/email via the directory service
 *   finance_settlement     — final pay, deductions, end-date payroll + expense, settlement statement
 *   legal_clearance        — post-exit obligations and whether a release is needed
 */

export const OFFBOARDING_REVIEW_KEYS = ['hr_exit_approval', 'it_access_deactivation', 'finance_settlement', 'legal_clearance'] as const
export type OffboardingReviewKey = (typeof OFFBOARDING_REVIEW_KEYS)[number]

export const OFFBOARDING_TASK_IDS: Record<OffboardingReviewKey, readonly string[]> = {
  hr_exit_approval: ['exit_details', 'manager_decision', 'notice_period', 'anomalies'],
  it_access_deactivation: ['access_inventory', 'kb_access', 'sso_email', 'app_login'],
  finance_settlement: ['final_pay', 'reimbursements', 'asset_deductions', 'records_deactivation', 'settlement_statement'],
  legal_clearance: ['confidentiality_obligations', 'restrictive_covenants', 'release_document'],
}

/** Which department owns each review (and so sees the full log / clicks Verify). */
export const OFFBOARDING_REVIEW_OWNER: Record<OffboardingReviewKey, string> = {
  hr_exit_approval: 'HR',
  it_access_deactivation: 'IT',
  finance_settlement: 'Finance',
  legal_clearance: 'Legal',
}

export function isOffboardingReviewKey(value: string): value is OffboardingReviewKey {
  return (OFFBOARDING_REVIEW_KEYS as readonly string[]).includes(value)
}

type Facts = AiLogTaskFacts<string>
const SHARED_PROMPT_RULES =
  ' Each task\'s status, evidence and issues were determined by code and are authoritative. Write the HR summary and one recommendation per task. Never invent facts, figures, dates, records or legal advice that are not in the findings.'

function fallbackSummary(label: string) {
  return (facts: AiLogFacts<string>, overall: string) => {
    const flagged = facts.tasks.filter((t) => t.status === 'failed' || t.status === 'warning').length
    const missing = facts.missingData.length > 0 ? ` Missing: ${facts.missingData.join(', ')}.` : ''
    const state = overall === 'ready' ? 'is ready for sign-off' : overall === 'blocked' ? 'is blocked' : 'needs attention before sign-off'
    return `The ${label} ${state}, with ${flagged} of ${facts.tasks.length} tasks flagged.${missing}`
  }
}

// ---------- hr_exit_approval ----------

type NoticePolicy = { days: number; raw: string; source: string; label: string }

type HrExitSource = {
  ctx: OffboardingContext
  details: ExitDetails
  manager: User | null
  managerDecision: ReturnType<typeof getLatestDecision>
  noticePolicy: NoticePolicy | null
  today: string
}

/** "30 days" / "4 weeks" / "1 month" → days; null if the text carries no period. */
export function parseNoticeDays(text: string): number | null {
  const match = /(\d+)\s*(day|week|month)s?/i.exec(text)
  if (!match) return null
  const n = Number(match[1])
  const unit = match[2].toLowerCase()
  return unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30
}

/** The notice period from the employee's offer letter, if one is on file and states it. */
function findNoticePolicy(ctx: OffboardingContext): NoticePolicy | null {
  const docs = listWorkflowsByEmployee(ctx.employee.id).flatMap((w) => listEmployeeDocumentsByWorkflow(w.id))
  const offer = docs.find((d) => d.documentType === 'offer_letter')
  if (!offer) return null
  for (const [key, value] of Object.entries(offer.extractedFields)) {
    if (!/notice/i.test(key) || typeof value !== 'string') continue
    const days = parseNoticeDays(value)
    if (days !== null) return { days, raw: value, label: `Offer letter (${offer.fileName})`, source: `employee_documents/${offer.id}.extracted_fields.${key}` }
  }
  return null
}

const EXIT_COLUMN: Record<string, string> = {
  exitType: 'exit_type',
  reason: 'reason',
  lastWorkingDay: 'last_working_day',
  noticeStartDate: 'notice_start_date',
  forwardingContact: 'forwarding_contact',
}

/** Where a value came from, for the evidence table: "Employee-submitted by Mei Tanaka · 2026-10-05 09:12 UTC — …". */
function provenance(details: ExitDetails, field: keyof ExitDetails['sources']) {
  const column = `offboarding_exit_details/${details.workflowId}.${EXIT_COLUMN[field]}`
  const src = details.sources[field]
  if (!src) return column
  const who = src.by ? (getUserById(src.by)?.name ?? 'unknown user') : null
  const label = src.source === 'employee' ? 'Employee-submitted' : src.source === 'hr' ? 'HR-entered' : 'System (employee record)'
  return `${label}${who ? ` by ${who}` : ''} · ${utcStamp(src.at)} — ${column}`
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

function buildHrExitFacts(source: HrExitSource): AiLogFacts<string> {
  const { ctx, details, manager, managerDecision, noticePolicy, today } = source
  const missingData: string[] = []
  const wf = ctx.workflow.id
  const termination = details.exitType === 'termination'

  // --- exit details ---
  const detailsEvidence: AiLogEvidence[] = [
    { type: 'profile_field', label: 'Exit type', value: details.exitType === 'not_recorded' ? '(not set)' : details.exitType, source: provenance(details, 'exitType') },
    { type: 'profile_field', label: 'Reason', value: details.reason ?? '(not recorded)', source: provenance(details, 'reason') },
    { type: 'profile_field', label: 'Forwarding contact', value: details.forwardingContact ?? '(not recorded)', source: provenance(details, 'forwardingContact') },
  ]
  const detailIssues: string[] = []
  if (details.exitType === 'not_recorded') {
    detailIssues.push('The exit type (resignation or termination) has not been set by HR.')
    missingData.push(EXIT_TYPE_MISSING_LABEL)
  }
  if (!details.reason) {
    detailIssues.push(termination ? 'A termination has no recorded reason.' : 'No reason for leaving is recorded.')
    missingData.push(EXIT_DETAIL_FIELDS.reason.missingDataLabel)
  }
  if (!details.forwardingContact) {
    detailIssues.push('No forwarding contact (personal email or phone) is recorded.')
    missingData.push(EXIT_DETAIL_FIELDS.forwardingContact.missingDataLabel)
  }

  // --- manager decision ---
  const decisionEvidence: AiLogEvidence[] = [
    { type: 'check', label: 'Reporting manager', value: manager?.name ?? 'Not assigned', source: `employees/${ctx.employee.id}.manager_id` },
  ]
  const decisionIssues: string[] = []
  if (managerDecision) {
    decisionEvidence.push({
      type: 'check',
      label: 'Manager decision',
      value: `${managerDecision.decision === 'approved' ? 'Approved' : 'Sent back'} by ${getUserById(managerDecision.decidedBy)?.name ?? 'manager'} at ${utcStamp(managerDecision.decidedAt)}${managerDecision.comment ? ` — "${managerDecision.comment}"` : ''}`,
      source: `offboarding_decisions/${managerDecision.id}`,
    })
    if (managerDecision.decision === 'sent_back') decisionIssues.push('The manager sent the exit back instead of approving it.')
  } else {
    decisionIssues.push('No manager decision is on record.')
  }

  // --- last working day & notice period ---
  const lwd = details.lastWorkingDay
  const start = details.noticeStartDate
  const noticeIssues: string[] = []
  let noticeFailed = false
  const noticeEvidence: AiLogEvidence[] = [
    { type: 'profile_field', label: 'Last working day', value: lwd ?? '(not set)', source: provenance(details, 'lastWorkingDay') },
    { type: 'profile_field', label: 'Notice start date', value: start ?? '(not recorded)', source: provenance(details, 'noticeStartDate') },
  ]
  if (!lwd) {
    noticeIssues.push('No last working day is recorded.')
    missingData.push(EXIT_DETAIL_FIELDS.lastWorkingDay.missingDataLabel)
  }
  if (!start) {
    noticeIssues.push('No notice start date is recorded, so the notice period cannot be checked.')
    missingData.push(EXIT_DETAIL_FIELDS.noticeStartDate.missingDataLabel)
  }
  if (lwd && details.lwdConfirmedAt) {
    const confirmer = details.lwdConfirmedBy ? (getUserById(details.lwdConfirmedBy)?.name ?? 'HR') : 'HR'
    noticeEvidence.push({
      type: 'check',
      label: 'HR confirmation',
      value: `Last working day confirmed by ${confirmer} at ${utcStamp(details.lwdConfirmedAt)}${lwd < today ? ' — accepted although it is in the past' : ''}`,
      source: `offboarding_exit_details/${wf}.lwd_confirmed_at`,
    })
  } else if (lwd && lwd < today) {
    noticeIssues.push(`The last working day (${lwd}) is in the past and has not been confirmed by HR.`)
    noticeEvidence.push({ type: 'check', label: 'Last working day vs today', value: `${lwd} is before ${today}`, source: provenance(details, 'lastWorkingDay') })
  }
  if (lwd && start) {
    const given = daysBetween(start, lwd)
    noticeEvidence.push({ type: 'check', label: 'Notice given', value: `${given} day(s) (${start} → ${lwd})`, source: `offboarding_exit_details/${wf}.notice_start_date → last_working_day` })
    if (given < 0) {
      noticeFailed = true
      noticeIssues.push('The notice start date is after the last working day.')
    } else if (noticePolicy) {
      noticeEvidence.push({ type: 'document', label: 'Required notice', value: `${noticePolicy.days} day(s) — "${noticePolicy.raw}" (${noticePolicy.label})`, source: noticePolicy.source })
      if (given < noticePolicy.days) noticeIssues.push(`Notice given (${given} days) is shorter than the ${noticePolicy.days} days required by the offer letter.`)
    }
  }
  if (!noticePolicy) {
    noticeEvidence.push({
      type: 'check',
      label: 'Notice policy',
      value: 'Notice policy not available — no offer letter with a notice period is on file (information only)',
      source: `employee_documents (employee ${ctx.employee.id})`,
    })
  }

  // --- anything unusual: concrete, evidence-backed findings only ---
  const anomalies: string[] = []
  const anomalyEvidence: AiLogEvidence[] = []
  if (ctx.employee.dateOfJoining && lwd) {
    const tenureDays = daysBetween(ctx.employee.dateOfJoining, lwd)
    if (tenureDays < 0) {
      anomalies.push(`The last working day (${lwd}) is before the joining date (${ctx.employee.dateOfJoining}).`)
      anomalyEvidence.push({ type: 'profile_field', label: 'Joining date', value: ctx.employee.dateOfJoining, source: `employees/${ctx.employee.id}.date_of_joining` })
    } else if (tenureDays < 90) {
      anomalies.push(`Very short tenure: ${tenureDays} days (joined ${ctx.employee.dateOfJoining}).`)
      anomalyEvidence.push({ type: 'profile_field', label: 'Tenure', value: `${tenureDays} day(s) (joined ${ctx.employee.dateOfJoining})`, source: `employees/${ctx.employee.id}.date_of_joining` })
    }
  }
  if (anomalies.length === 0) {
    anomalyEvidence.push({
      type: 'check',
      label: 'Unusual circumstances',
      value: 'Nothing unusual found (checked tenure and date ordering against the employee record)',
      source: `employees/${ctx.employee.id}`,
    })
  }

  const tasks: Facts[] = [
    {
      id: 'exit_details',
      title: 'Exit details',
      status: detailIssues.length === 0 ? 'done' : 'warning',
      actionsTaken: ['Read the exit type, reason and forwarding contact, and where each value came from.'],
      evidence: detailsEvidence,
      issues: detailIssues,
      fallbackRecommendation:
        detailIssues.length === 0
          ? 'Exit details are complete — no action needed.'
          : termination
            ? 'Fill in the missing details with Edit exit details (terminations are HR-entered).'
            : 'Request the missing details from the employee, or set them with Edit exit details.',
    },
    {
      id: 'manager_decision',
      title: "Manager's decision",
      status: decisionIssues.length === 0 ? 'done' : 'failed',
      blocking: decisionIssues.length > 0,
      actionsTaken: ["Read the reporting manager's recorded decision."],
      evidence: decisionEvidence,
      issues: decisionIssues,
      fallbackRecommendation: decisionIssues.length === 0 ? 'The manager approved the exit — no action needed.' : 'Resolve the manager decision before approving.',
    },
    {
      id: 'notice_period',
      title: 'Last working day & notice period',
      status: noticeFailed ? 'failed' : noticeIssues.length === 0 ? 'done' : 'warning',
      actionsTaken: ['Compared the notice start date with the last working day, and against the notice period on the offer letter if one is on file.'],
      evidence: noticeEvidence,
      issues: noticeIssues,
      fallbackRecommendation: noticeIssues.length === 0 ? 'Dates are consistent — no action needed.' : 'Confirm or correct the dates with Edit exit details.',
    },
    {
      id: 'anomalies',
      title: 'Anything unusual',
      status: anomalies.length === 0 ? 'done' : 'warning',
      actionsTaken: ['Checked tenure and date ordering against the employee record.'],
      evidence: anomalyEvidence,
      issues: anomalies,
      fallbackRecommendation: anomalies.length === 0 ? 'Done — nothing unusual found.' : 'Review the flagged points before approving.',
    },
  ]
  return { tasks, missingData }
}

const HR_EXIT_CONFIG: AiVerificationStepConfig<HrExitSource, string> = {
  label: 'HR exit pre-check',
  taskIds: OFFBOARDING_TASK_IDS.hr_exit_approval,
  buildFacts: buildHrExitFacts,
  systemPrompt:
    "You are an HR operations assistant preparing a pre-check before HR approves an employee's exit." +
    SHARED_PROMPT_RULES +
    " Only mention concerns that appear in a task's issues list. For a task with status \"done\", say no action is needed (for \"Anything unusual\": \"Done — nothing unusual found\") and add no caveats, general advice or speculative risks. Information-only evidence such as \"notice policy not available\" is not a concern. Never produce generic warnings.",
  fallbackSummary: fallbackSummary('HR exit pre-check'),
}

// ---------- it_access_deactivation ----------

const HANDOVER_KB_CATEGORIES = HANDOVER_CATEGORIES

type ItAccessSource = { ctx: OffboardingContext; details: ExitDetails }

/** Performs the access changes. Idempotent: every change is keyed by (workflow, system, target),
 * so a re-run neither double-revokes nor opens a second directory ticket. */
function applyItAccessActions(ctx: OffboardingContext, details: ExitDetails, userId: string | null) {
  const wf = ctx.workflow.id
  for (const grant of listActiveKbGrantIds(ctx.employee.id)) {
    if (getAccessAction(wf, 'kb_grant', grant.id)?.status === 'active') continue
    revokeKbGrant(grant.id, wf)
    upsertAccessAction({
      workflowId: wf,
      system: 'kb_grant',
      targetRef: grant.id,
      description: `Revoked Knowledge Base grant (${grant.categories.join(', ')})`,
      action: 'revoked',
      externalRef: null,
      effectiveDate: null,
      createdBy: userId,
    })
  }
  upsertAccessAction({
    workflowId: wf,
    system: 'kb_department_visibility',
    targetRef: ctx.employee.id,
    description: `Removed department/sensitive Knowledge Base categories — only ${HANDOVER_KB_CATEGORIES.join(', ')} remain for handover until exit`,
    action: 'revoked',
    externalRef: null,
    effectiveDate: null,
    createdBy: userId,
  })
  const email = ctx.user?.email
  if (email) {
    for (const system of ['sso', 'email'] as const) {
      if (getAccessAction(wf, system, email)?.status === 'active') continue
      const ticket = directoryService().scheduleDeactivation(system, email, details.lastWorkingDay)
      upsertAccessAction({
        workflowId: wf,
        system,
        targetRef: email,
        description: `${system === 'sso' ? 'SSO account' : 'Mailbox'} deactivation scheduled`,
        action: 'scheduled',
        externalRef: ticket.id,
        effectiveDate: details.lastWorkingDay,
        createdBy: userId,
      })
    }
  }
  if (ctx.user) {
    upsertAccessAction({
      workflowId: wf,
      system: 'app_login',
      targetRef: ctx.user.id,
      description: 'App login kept (restricted) until Exit Completed, then deactivated',
      action: 'scheduled',
      externalRef: null,
      effectiveDate: null,
      createdBy: userId,
    })
  }
}

function buildItAccessFacts({ ctx }: ItAccessSource): AiLogFacts<string> {
  const wf = ctx.workflow.id
  const actions = listAccessActions(wf, true)
  const byId = (system: string) => actions.filter((a) => a.system === system)
  const grantRows = getDb()
    .prepare('SELECT id, categories, revoked_at, revoked_by_workflow_id FROM employee_kb_grants WHERE employee_id = ?')
    .all(ctx.employee.id) as { id: string; categories: string; revoked_at: string | null; revoked_by_workflow_id: string | null }[]

  const inventory: AiLogEvidence[] = [
    {
      type: 'check',
      label: 'App login',
      value: ctx.user ? `${ctx.user.email} — ${ctx.user.isActive ? 'active' : 'inactive'}` : 'No login account',
      source: ctx.user ? `users/${ctx.user.id}` : 'users',
    },
    {
      type: 'check',
      label: 'Knowledge Base grants',
      value: grantRows.length === 0 ? 'None on file' : grantRows.map((g) => JSON.parse(g.categories).join(', ')).join('; '),
      source: grantRows.length === 0 ? 'employee_kb_grants' : grantRows.map((g) => `employee_kb_grants/${g.id}`).join(', '),
    },
    { type: 'check', label: 'Department KB visibility', value: ctx.department ?? 'No department', source: `employees/${ctx.employee.id}.department_id` },
    { type: 'check', label: 'SSO / email account', value: ctx.user?.email ?? 'None on file', source: ctx.user ? `users/${ctx.user.id}.email` : 'users' },
  ]

  const kbEvidence: AiLogEvidence[] = [...byId('kb_grant'), ...byId('kb_department_visibility')].map((a) => ({
    type: 'record_created' as const,
    label: a.description,
    value: `Revoked ${utcStamp(a.createdAt)}`,
    source: `access_actions/${a.id}`,
  }))
  const kbIssues: string[] = []
  if (!byId('kb_department_visibility').length) kbIssues.push('Department Knowledge Base access has not been removed.')
  if (grantRows.some((g) => !g.revoked_at)) kbIssues.push('A Knowledge Base grant is still active.')
  const kbActions = [
    grantRows.length === 0 ? 'Looked for Knowledge Base grants — nothing to remove.' : `Revoked ${grantRows.filter((g) => g.revoked_by_workflow_id === wf).length} Knowledge Base grant(s).`,
    `Restricted Knowledge Base visibility to ${HANDOVER_KB_CATEGORIES.join(', ')} for the handover period.`,
  ]

  const ssoActions = [...byId('sso'), ...byId('email')]
  const ssoEvidence: AiLogEvidence[] = ssoActions.map((a) => {
    const ticket = a.externalRef ? directoryService().get(a.externalRef) : null
    return {
      type: 'record_created' as const,
      label: a.description,
      value: `${ticket?.status ?? 'scheduled'} for ${a.effectiveDate ?? 'exit completion'}`,
      source: `directory_tickets/${a.externalRef} (access_actions/${a.id})`,
    }
  })
  const ssoIssues = ctx.user?.email ? (ssoActions.length < 2 ? ['SSO/email deactivation is not fully scheduled.'] : []) : ['No email/SSO account is on file to deactivate.']

  const login = byId('app_login')[0]
  return {
    tasks: [
      { id: 'access_inventory', title: 'Access inventory', status: 'done', actionsTaken: ["Listed every access the employee holds from the users, Knowledge Base grant and department records."], evidence: inventory, issues: [], fallbackRecommendation: 'Inventory complete.' },
      { id: 'kb_access', title: 'Knowledge Base access', status: kbIssues.length === 0 ? 'done' : 'failed', actionsTaken: kbActions, evidence: kbEvidence, issues: kbIssues, fallbackRecommendation: kbIssues.length === 0 ? 'Knowledge Base access is reduced to handover categories.' : 'Re-run to remove the remaining access.' },
      { id: 'sso_email', title: 'SSO & email', status: ssoIssues.length === 0 ? 'done' : 'warning', actionsTaken: ['Scheduled SSO and mailbox deactivation for the last working day via the directory service.'], evidence: ssoEvidence, issues: ssoIssues, fallbackRecommendation: ssoIssues.length === 0 ? 'Deactivation is scheduled.' : 'Deactivate SSO/email manually.' },
      {
        id: 'app_login',
        title: 'App login',
        status: login ? 'done' : 'warning',
        actionsTaken: ['Kept the app login active (restricted to offboarding) until Exit Completed.'],
        evidence: login ? [{ type: 'record_created', label: 'Login deactivation', value: 'Scheduled for Exit Completed', source: `access_actions/${login.id}` }] : [],
        issues: login ? [] : ['No app login on file.'],
        fallbackRecommendation: 'The login is deactivated when HR marks the exit complete.',
      },
    ],
    missingData: [],
  }
}

const IT_ACCESS_CONFIG: AiVerificationStepConfig<ItAccessSource, string> = {
  label: 'IT access deactivation',
  taskIds: OFFBOARDING_TASK_IDS.it_access_deactivation,
  buildFacts: buildItAccessFacts,
  systemPrompt: 'You are an IT operations assistant summarising the access deactivation performed for an exiting employee.' + SHARED_PROMPT_RULES,
  fallbackSummary: fallbackSummary('IT access deactivation'),
}

// ---------- finance_settlement ----------

type SettlementSource = { ctx: OffboardingContext; details: ExitDetails }

function daysInMonth(isoDate: string) {
  const [y, m] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The final pay Finance entered by hand (lib/offboarding/final-pay.ts), kept on the settlement
 * statement — so reverting Finance Settlement (which voids the statement) clears it too. */
export type ManualFinalPay = { amount: number; currency: string; note: string | null; enteredBy: string; enteredByName: string; enteredAt: string }

export function manualFinalPayFor(workflowId: string): ManualFinalPay | null {
  return (getSettlementStatement(workflowId)?.statement.manualFinalPay as ManualFinalPay | undefined) ?? null
}

/** Finance's confirmation of pending reimbursements (lib/offboarding/final-pay.ts) — no claims
 * system is connected, so Finance confirms either that nothing is outstanding or the amount to pay
 * with the settlement. Kept on the statement, so reverting Finance Settlement clears it too. */
export type ReimbursementConfirmation = {
  outstanding: boolean
  amount: number | null
  currency: string | null
  note: string | null
  confirmedBy: string
  confirmedByName: string
  confirmedAt: string
}

export function reimbursementConfirmationFor(workflowId: string): ReimbursementConfirmation | null {
  return (getSettlementStatement(workflowId)?.statement.reimbursementConfirmation as ReimbursementConfirmation | undefined) ?? null
}

function reimbursementSummary(c: ReimbursementConfirmation) {
  return c.outstanding && c.amount !== null && c.currency
    ? `${c.currency} ${c.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding — paid with the final settlement`
    : 'None outstanding'
}

/** The settlement figures, from records only. Without a salary on file the final pay is the figure
 * Finance entered, or else a labelled placeholder (null) — never an invented number. A figure
 * calculated from payroll always wins over an entered one. */
export function computeSettlement(ctx: OffboardingContext, details: ExitDetails) {
  const records = listFinanceRecordsForEmployee(ctx.employee.id)
  const payroll = records.payroll.find((p) => !p.endedAt || p.endedByWorkflowId === ctx.workflow.id) ?? null
  const lwd = details.lastWorkingDay
  const manual = manualFinalPayFor(ctx.workflow.id)
  let finalPay: { amount: number | null; currency: string | null; basis: string; placeholder: boolean; source: 'payroll' | 'finance' | 'placeholder' }
  if (payroll && lwd) {
    const day = Number(lwd.slice(8, 10))
    const dim = daysInMonth(lwd)
    const amount = Math.round(((payroll.annualSalary / 12) * (day / dim)) * 100) / 100
    finalPay = { amount, currency: payroll.currency, basis: `Calculated: ${payroll.currency} ${payroll.annualSalary.toLocaleString('en-US')}/yr ÷ 12 × ${day}/${dim} calendar days of ${lwd.slice(0, 7)} (payroll_records/${payroll.id})`, placeholder: false, source: 'payroll' }
  } else if (manual) {
    finalPay = {
      amount: manual.amount,
      currency: manual.currency,
      basis: `Entered by Finance (${manual.enteredByName}) at ${utcStamp(manual.enteredAt)}${manual.note ? ` — ${manual.note}` : ''}`,
      placeholder: false,
      source: 'finance',
    }
  } else {
    finalPay = {
      amount: null,
      currency: null,
      basis: payroll ? 'Placeholder — no last working day recorded' : 'Placeholder — no salary on file (no payroll entry for this employee); Finance must enter the final pay',
      placeholder: true,
      source: 'placeholder',
    }
  }
  const missingAssets = listAssetReturnItems(ctx.workflow.id).filter((i) => i.status === 'missing')
  return {
    payroll,
    expense: records.expense,
    finalPay,
    deductions: missingAssets.map((a) => ({ assetId: a.assetId, asset: a.assetName, serial: a.serialNumber, value: null as number | null, valueBasis: 'Placeholder — asset value not on file' })),
  }
}

function applySettlementActions(ctx: OffboardingContext, details: ExitDetails, userId: string | null) {
  const wf = ctx.workflow.id
  const endDate = details.lastWorkingDay ?? new Date().toISOString().slice(0, 10)
  const records = listFinanceRecordsForEmployee(ctx.employee.id)
  for (const p of records.payroll) {
    if (p.endedAt) continue
    endFinanceRecord('payroll_records', p.id, endDate, wf)
    upsertAccessAction({ workflowId: wf, system: 'payroll', targetRef: p.id, description: `Payroll entry end-dated ${endDate}`, action: 'deactivated', externalRef: null, effectiveDate: endDate, createdBy: userId })
  }
  for (const e of records.expense) {
    if (e.endedAt) continue
    endFinanceRecord('expense_accounts', e.id, endDate, wf)
    upsertAccessAction({ workflowId: wf, system: 'expense', targetRef: e.id, description: `Expense account closed ${endDate}`, action: 'deactivated', externalRef: null, effectiveDate: endDate, createdBy: userId })
  }
  const s = computeSettlement(ctx, details)
  const manualFinalPay = manualFinalPayFor(wf)
  const reimbursementConfirmation = reimbursementConfirmationFor(wf)
  upsertSettlementStatement(wf, {
    employee: ctx.name,
    lastWorkingDay: details.lastWorkingDay,
    finalPay: s.finalPay,
    reimbursements: reimbursementConfirmation
      ? { status: reimbursementConfirmation.outstanding ? 'outstanding' : 'none_outstanding', amount: reimbursementConfirmation.amount, currency: reimbursementConfirmation.currency, note: `Confirmed by Finance (${reimbursementConfirmation.confirmedByName})` }
      : { status: 'none_recorded', note: 'No reimbursement-claims system is connected; no claims are on record.' },
    deductions: s.deductions,
    deactivated: listAccessActions(wf, true).filter((a) => a.system === 'payroll' || a.system === 'expense').map((a) => a.targetRef),
    ...(manualFinalPay ? { manualFinalPay } : {}),
    ...(reimbursementConfirmation ? { reimbursementConfirmation } : {}),
  })
}

function buildSettlementFacts({ ctx, details }: SettlementSource): AiLogFacts<string> {
  const wf = ctx.workflow.id
  const s = computeSettlement(ctx, details)
  const statement = getSettlementStatement(wf)
  const ended = listAccessActions(wf, true).filter((a) => a.system === 'payroll' || a.system === 'expense')
  const reimb = reimbursementConfirmationFor(wf)
  const missingData: string[] = []
  if (s.finalPay.placeholder) missingData.push('Salary / final pay figure')

  return {
    tasks: [
      {
        id: 'final_pay',
        title: 'Final pay to last working day',
        status: s.finalPay.placeholder ? 'warning' : 'done',
        actionsTaken: [
          s.finalPay.source === 'finance'
            ? 'The final pay could not be calculated from payroll — used the figure Finance entered.'
            : s.payroll
              ? `Read payroll entry ${s.payroll.id} and prorated pay to the last working day.`
              : 'Looked for a payroll entry for this employee — none on file.',
        ],
        evidence: [
          {
            type: 'check',
            label: 'Final pay',
            value: s.finalPay.amount === null ? 'Not calculated (placeholder)' : `${s.finalPay.currency} ${s.finalPay.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            source: s.finalPay.basis,
          },
        ],
        issues: s.finalPay.placeholder ? [s.finalPay.basis] : [],
        fallbackRecommendation: s.finalPay.placeholder ? 'Enter the final pay manually in the payroll system.' : 'Confirm the calculated final pay.',
      },
      {
        id: 'reimbursements',
        title: 'Pending reimbursements',
        status: reimb ? 'done' : 'warning',
        actionsTaken: reimb
          ? ['Looked for pending reimbursement claims — no claims system is connected, so used the confirmation Finance recorded.']
          : ['Looked for pending reimbursement claims.'],
        evidence: reimb
          ? [
              {
                type: 'check',
                label: 'Reimbursement claims',
                value: reimbursementSummary(reimb),
                source: `Confirmed by Finance (${reimb.confirmedByName}) at ${utcStamp(reimb.confirmedAt)}${reimb.note ? ` — ${reimb.note}` : ''}`,
              },
            ]
          : [{ type: 'check', label: 'Reimbursement claims', value: 'None on record', source: 'No reimbursement-claims system is connected' }],
        issues: reimb ? [] : ['No reimbursement-claims system is connected — confirm with the employee that nothing is outstanding.'],
        fallbackRecommendation: reimb ? (reimb.outstanding ? 'Pay the outstanding reimbursements with the final settlement.' : 'No reimbursements to pay.') : 'Confirm no reimbursements are outstanding.',
      },
      {
        id: 'asset_deductions',
        title: 'Deductions for unreturned assets',
        status: s.deductions.length === 0 ? 'done' : 'warning',
        actionsTaken: ['Read the asset return checklist for missing items.'],
        evidence:
          s.deductions.length === 0
            ? [{ type: 'check', label: 'Missing assets', value: 'None', source: `asset_return_items (workflow ${wf})` }]
            : s.deductions.map((d) => ({ type: 'check' as const, label: `Missing: ${d.asset}`, value: d.valueBasis, source: `assets/${d.assetId}` })),
        issues: s.deductions.length === 0 ? [] : [`${s.deductions.length} asset(s) missing — values are not on file, so deductions are placeholders.`],
        fallbackRecommendation: s.deductions.length === 0 ? 'No deductions.' : 'Decide the deduction amount for each missing asset.',
      },
      {
        id: 'records_deactivation',
        title: 'Payroll & expense records',
        status: 'done',
        actionsTaken: [ended.length === 0 ? 'Looked for an active payroll entry and expense account — nothing to deactivate.' : `End-dated ${ended.length} record(s) at the last working day.`],
        evidence: ended.length === 0
          ? [{ type: 'check', label: 'Payroll / expense records', value: 'Nothing to remove', source: `payroll_records, expense_accounts (employee ${ctx.employee.id})` }]
          : ended.map((a) => ({ type: 'record_created' as const, label: a.description, value: `End-dated ${a.effectiveDate}`, source: `${a.system === 'payroll' ? 'payroll_records' : 'expense_accounts'}/${a.targetRef}` })),
        issues: [],
        fallbackRecommendation: 'Records are end-dated.',
      },
      {
        id: 'settlement_statement',
        title: 'Settlement statement',
        status: statement ? 'done' : 'failed',
        actionsTaken: ['Produced the settlement statement.'],
        evidence: statement ? [{ type: 'record_created', label: 'Settlement statement', value: `Updated ${utcStamp(statement.updatedAt)}`, source: `settlement_statements/${statement.id}` }] : [],
        issues: statement ? [] : ['The settlement statement could not be produced.'],
        fallbackRecommendation: 'Review the statement.',
      },
    ],
    missingData,
  }
}

const SETTLEMENT_CONFIG: AiVerificationStepConfig<SettlementSource, string> = {
  label: 'Finance settlement',
  taskIds: OFFBOARDING_TASK_IDS.finance_settlement,
  buildFacts: buildSettlementFacts,
  systemPrompt: "You are a finance operations assistant summarising an exiting employee's final settlement." + SHARED_PROMPT_RULES,
  fallbackSummary: fallbackSummary('finance settlement'),
}

// ---------- legal_clearance ----------

type LegalClearanceSource = { ctx: OffboardingContext; details: ExitDetails }

/** What Legal can find on record: signed agreements, and non-compete / notice clauses in the offer letter. */
export function legalClearanceRecords(ctx: OffboardingContext) {
  const agreements = getDb()
    .prepare('SELECT id, title, version, signed_at, signed_name FROM legal_agreements WHERE employee_id = ?')
    .all(ctx.employee.id) as { id: string; title: string; version: string; signed_at: string | null; signed_name: string | null }[]
  const signed = agreements.filter((a) => a.signed_at)
  const docs = listWorkflowsByEmployee(ctx.employee.id).flatMap((w) => listEmployeeDocumentsByWorkflow(w.id))
  const offer = docs.find((d) => d.documentType === 'offer_letter')
  const clauseFields = offer ? Object.entries(offer.extractedFields).filter(([k]) => /non.?compete|notice|restrict|solicit/i.test(k)) : []
  return { signed, offer, clauseFields }
}

/** What Legal confirmed by hand when the records can't settle a task (lib/offboarding/legal-clearance.ts):
 * the employee acknowledged their confidentiality obligations at exit, or Legal reviewed the
 * contract for restrictive covenants. Kept as workflow events; only those after the latest revert
 * of Legal Clearance count, so reverting the step clears them. */
export type LegalConfirmationTask = 'confidentiality_obligations' | 'restrictive_covenants'
export type LegalConfirmation = {
  task: LegalConfirmationTask
  /** restrictive_covenants only: whether any non-compete / notice clauses apply. */
  clausesApply: boolean | null
  clauses: string | null
  note: string | null
  confirmedBy: string | null
  confirmedByName: string
  confirmedAt: string
}

export function legalConfirmationsFor(workflowId: string): Record<LegalConfirmationTask, LegalConfirmation | null> {
  const result: Record<LegalConfirmationTask, LegalConfirmation | null> = { confidentiality_obligations: null, restrictive_covenants: null }
  for (const e of listWorkflowEvents(workflowId)) {
    if (e.stepKey !== 'legal_clearance') continue
    if (e.action === 'reverted') {
      result.confidentiality_obligations = null
      result.restrictive_covenants = null
    } else if (e.action === 'legal_confirmed' && (e.detail.task === 'confidentiality_obligations' || e.detail.task === 'restrictive_covenants')) {
      result[e.detail.task as LegalConfirmationTask] = {
        task: e.detail.task,
        clausesApply: typeof e.detail.clausesApply === 'boolean' ? e.detail.clausesApply : null,
        clauses: e.detail.clauses ?? null,
        note: e.detail.note ?? null,
        confirmedBy: e.performedBy,
        confirmedByName: e.detail.confirmedByName ?? 'Legal',
        confirmedAt: e.performedAt,
      }
    }
  }
  return result
}

function confirmedBy(c: LegalConfirmation) {
  return `Confirmed by Legal (${c.confirmedByName}) at ${utcStamp(c.confirmedAt)}${c.note ? ` — ${c.note}` : ''}`
}

function buildLegalClearanceFacts({ ctx, details }: LegalClearanceSource): AiLogFacts<string> {
  const { signed, offer, clauseFields } = legalClearanceRecords(ctx)
  const confirmations = legalConfirmationsFor(ctx.workflow.id)
  const ack = signed.length === 0 ? confirmations.confidentiality_obligations : null
  const review = clauseFields.length === 0 ? confirmations.restrictive_covenants : null
  const missingData: string[] = []

  const confidentiality: Facts = {
    id: 'confidentiality_obligations',
    title: 'Confidentiality / IP obligations',
    status: signed.length > 0 || ack ? 'done' : 'warning',
    actionsTaken: ack
      ? ['Looked for signed confidentiality / NDA agreements on file — none, so used the acknowledgement Legal recorded.']
      : ['Looked for signed confidentiality / NDA agreements on file.'],
    evidence: ack
      ? [
          { type: 'check', label: 'Signed agreements', value: 'None on file', source: `legal_agreements (employee ${ctx.employee.id})` },
          { type: 'check', label: 'Confidentiality obligations', value: 'Employee acknowledged their confidentiality / IP obligations at exit', source: confirmedBy(ack) },
        ]
      : signed.length > 0
        ? signed.map((a) => ({
            type: 'document' as const,
            label: a.title,
            value: `Signed by "${a.signed_name}" ${a.signed_at!.slice(0, 10)} — ${a.version === CONFIDENTIALITY_AGREEMENT_VERSION ? 'obligations continue 3 years after employment ends (clause 5)' : 'see agreement for post-exit terms'}`,
            source: `legal_agreements/${a.id}`,
          }))
        : [{ type: 'check', label: 'Signed agreements', value: 'None on file', source: `legal_agreements (employee ${ctx.employee.id})` }],
    issues: signed.length > 0 || ack ? [] : ['No signed confidentiality agreement is on file — remind the employee of their general confidentiality obligations.'],
    fallbackRecommendation: signed.length > 0
      ? 'Remind the employee of the post-exit confidentiality term.'
      : ack
        ? 'Keep the acknowledgement with the exit paperwork.'
        : 'Send a confidentiality reminder with the exit paperwork.',
  }
  if (signed.length === 0 && !ack) missingData.push('Signed confidentiality agreement')

  const covenants: Facts = {
    id: 'restrictive_covenants',
    title: 'Non-compete / notice clauses',
    status: clauseFields.length > 0 || review ? 'done' : 'warning',
    actionsTaken: [
      offer ? `Read the offer letter (${offer.fileName}) for non-compete / notice clauses.` : 'Looked for an offer letter — none on file.',
      ...(review ? ['Used the contract review Legal recorded.'] : []),
    ],
    evidence: [
      ...(offer
        ? [
            { type: 'document' as const, label: 'Offer letter', value: offer.fileName, source: `employee_documents/${offer.id}` },
            ...clauseFields.map(([k, v]) => ({ type: 'profile_field' as const, label: k, value: v, source: `employee_documents/${offer.id}.extracted_fields.${k}` })),
          ]
        : [{ type: 'check' as const, label: 'Offer letter', value: 'Not on file', source: `employee_documents (employee ${ctx.employee.id})` }]),
      ...(review
        ? [
            {
              type: 'check' as const,
              label: 'Restrictive covenants (reviewed by Legal)',
              value: review.clausesApply ? `Apply: ${review.clauses}` : 'None apply',
              source: confirmedBy(review),
            },
          ]
        : []),
    ],
    issues:
      clauseFields.length > 0 || review
        ? []
        : [offer ? 'The offer letter is on file but no non-compete or notice clause was extracted — review the letter manually.' : 'No offer letter is on file to check for restrictive covenants.'],
    fallbackRecommendation:
      clauseFields.length > 0 || review?.clausesApply
        ? 'Remind the employee of the clauses found.'
        : review
          ? 'No restrictive covenants to remind the employee of.'
          : 'Review the employment contract manually.',
  }

  const releaseIssues: string[] = []
  if (details.exitType === 'termination') releaseIssues.push('This is a termination — a separation / release agreement is recommended.')
  if (details.exitType === 'not_recorded') releaseIssues.push('The exit type is not recorded, so whether a release is needed cannot be determined.')
  const release: Facts = {
    id: 'release_document',
    title: 'Exit / release document',
    status: releaseIssues.length === 0 ? 'done' : 'warning',
    actionsTaken: ['Checked the exit type to decide whether a release document is needed.'],
    evidence: [{ type: 'profile_field', label: 'Exit type', value: details.exitType.replace('_', ' '), source: `offboarding_exit_details/${ctx.workflow.id}.exit_type` }],
    issues: releaseIssues,
    fallbackRecommendation: releaseIssues.length === 0 ? 'No release document is needed for a resignation.' : 'Prepare a release agreement if appropriate.',
  }
  return { tasks: [confidentiality, covenants, release], missingData }
}

const LEGAL_CLEARANCE_CONFIG: AiVerificationStepConfig<LegalClearanceSource, string> = {
  label: 'Legal clearance',
  taskIds: OFFBOARDING_TASK_IDS.legal_clearance,
  buildFacts: buildLegalClearanceFacts,
  systemPrompt: "You are a legal operations assistant preparing a clearance summary for an exiting employee." + SHARED_PROMPT_RULES,
  fallbackSummary: fallbackSummary('legal clearance'),
}

// ---------- entry point ----------

/** Applies the step's actions (idempotently) and returns a fresh structured log. Used by Notify and
 * by every Re-run, so re-running never double-applies anything. */
export async function runOffboardingReview(
  key: OffboardingReviewKey,
  workflowId: string,
  userId: string | null,
  generate?: NarrativeGenerator,
): Promise<AiVerificationLog> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) throw new Error(`Not an offboarding workflow: ${workflowId}`)
  const details = exitDetailsFor(ctx)
  switch (key) {
    case 'hr_exit_approval':
      return runAiVerification(
        HR_EXIT_CONFIG,
        {
          ctx,
          details,
          manager: resolveManagerUser(ctx),
          managerDecision: getLatestDecision(workflowId, 'manager_exit_approval'),
          noticePolicy: findNoticePolicy(ctx),
          today: new Date().toISOString().slice(0, 10),
        },
        generate,
      )
    case 'it_access_deactivation':
      applyItAccessActions(ctx, details, userId)
      return runAiVerification(IT_ACCESS_CONFIG, { ctx, details }, generate)
    case 'finance_settlement':
      applySettlementActions(ctx, details, userId)
      return runAiVerification(SETTLEMENT_CONFIG, { ctx, details }, generate)
    case 'legal_clearance':
      return runAiVerification(LEGAL_CLEARANCE_CONFIG, { ctx, details }, generate)
  }
}


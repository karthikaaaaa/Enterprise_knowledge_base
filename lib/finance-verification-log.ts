import type {
  AiLogEvidence,
  AiLogFacts,
  AiLogOverallStatus,
  AiLogTaskFacts,
  AiVerificationStepConfig,
} from '@/lib/ai-verification-log'
import { resolveStructuredLogView } from '@/lib/ai-verification-log'
import { maskSensitive } from '@/lib/info-request-items'

/**
 * finance_verification's structured review log (see lib/ai-verification-log.ts for the shared
 * contract). Every status, issue and evidence row here is computed from the records in
 * FinanceVerificationSource — ids, field values and file names exactly as stored — never from model
 * text. The model only adds the HR summary and per-task recommendations.
 */

export const FINANCE_TASK_IDS = ['bank_tax_details', 'payroll_entry', 'expense_account', 'finance_signoff'] as const
export type FinanceTaskId = (typeof FINANCE_TASK_IDS)[number]

/** Everything the finance pre-check reads, compiled from workflows.db by compileFinanceVerificationSource
 * (workflow-actions.ts). File bytes are deliberately excluded. */
export type FinanceVerificationSource = {
  workflowId: string
  employee: { id: string; name: string; dateOfJoining: string | null }
  submission: {
    id: string
    fullName: string
    email: string
    phone: string
    roleTitle: string
    department: string
    startDate: string
  } | null
  documents: { id: string; documentType: string; fileName: string; extractedFields: Record<string, string> }[]
  documentCheck: { id: string; overallStatus: string } | null
  hrProfileEntryId: string | null
  /** Bank/tax details the employee submitted in answer to an info request — the newest non-empty
   * value per field, each with the employee_finance_details row it came from. Values are raw here;
   * they are masked before going into any evidence row. */
  financeDetails?: {
    accountHolder?: FinanceDetailValue
    bankAccountNumber?: FinanceDetailValue
    bankRoutingCode?: FinanceDetailValue
    taxId?: FinanceDetailValue
  }
  payrollRecord?: FinancePayrollRecordRef | null
  expenseAccount?: FinanceExpenseAccountRef | null
  signoffRecord?: FinanceSignoffRecordRef | null
}

export type FinanceDetailValue = { value: string; recordId: string; fileName: string | null }

/** A payroll entry already created for this workflow (lib/payroll.ts). Compensation is deliberately
 * not included — it never goes into the log, and so never reaches the model. */
export type FinancePayrollRecordRef = { id: string; createdAt: string; payFrequency: string; createdBy: string }

/** Expense account / sign-off pack already created for this workflow (lib/finance-records.ts). */
export type FinanceExpenseAccountRef = { id: string; createdAt: string; createdBy: string; costCenter: string }
export type FinanceSignoffRecordRef = { id: string; createdAt: string; createdBy: string }

/** The issue the sign-off task raises when every prerequisite is met and only the pack is missing
 * — lib/finance-records.ts filters it out to tell "ready to create" apart from "blocked". */
export const SIGNOFF_READY_ISSUE = 'Every finance prerequisite is in place — Finance needs to create the sign-off pack.'
export const EXPENSE_DRAFTED_ISSUE = 'The expense account is drafted from these records — Finance needs to confirm and create it.'

function utcStamp(iso: string) {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

const DOCUMENT_LABELS: Record<string, string> = {
  government_id: 'Government ID',
  offer_letter: 'Offer Letter',
  address_proof: 'Proof of Address',
  photo: 'Photo',
}

const BANK_FIELD = /bank|iban|account.?(no|num)|routing|sort.?code|swift|bic/i
const TAX_FIELD = /tax|\btin\b|ssn|social.?security|\bpan\b|national.?insurance/i

/** In-app link that streams the stored document to a Finance/HR viewer (see the documents route). */
export function financeDocumentLink(workflowId: string, documentId: string) {
  return `/api/workflows/${workflowId}/steps/finance_verification/documents/${documentId}`
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function submissionSource(source: FinanceVerificationSource, field: string) {
  return `employee_detail_submissions.${field} (${source.submission?.id})`
}

function documentEvidence(source: FinanceVerificationSource, doc: FinanceVerificationSource['documents'][number]): AiLogEvidence {
  return {
    type: 'document',
    label: DOCUMENT_LABELS[doc.documentType] ?? doc.documentType,
    value: doc.fileName,
    source: `employee_documents/${doc.id}`,
    link: financeDocumentLink(source.workflowId, doc.id),
  }
}

const FINANCE_DETAIL_COLUMNS = {
  accountHolder: { column: 'account_holder', label: 'Account holder', sensitive: false },
  bankAccountNumber: { column: 'bank_account_number', label: 'Bank account number', sensitive: true },
  bankRoutingCode: { column: 'bank_routing_code', label: 'Bank / routing code', sensitive: false },
  taxId: { column: 'tax_id', label: 'Tax ID', sensitive: true },
} as const

/** Evidence rows for the employee's submitted finance details. Account and tax numbers are masked
 * to the last 4 characters — the evidence cites where the full value lives, never the value. */
function financeDetailEvidence(source: FinanceVerificationSource, keys: (keyof typeof FINANCE_DETAIL_COLUMNS)[]) {
  const found: AiLogEvidence[] = []
  for (const key of keys) {
    const detail = source.financeDetails?.[key]
    if (!detail) continue
    const meta = FINANCE_DETAIL_COLUMNS[key]
    found.push({
      type: 'profile_field',
      label: meta.label,
      value: meta.sensitive ? maskSensitive(detail.value) : detail.value,
      source: `employee_finance_details/${detail.recordId}.${meta.column}`,
      ...(detail.fileName ? { link: financeDetailsFileLink(source.workflowId, detail.recordId) } : {}),
    })
  }
  return found
}

/** In-app link to the supporting file the employee attached to their finance details, if any. */
export function financeDetailsFileLink(workflowId: string, recordId: string) {
  return `/api/workflows/${workflowId}/steps/finance_verification/finance-details/${recordId}`
}

/** Fields found in uploaded documents that look like bank/tax details (values masked). */
function findFields(source: FinanceVerificationSource, pattern: RegExp) {
  const found: AiLogEvidence[] = []
  for (const doc of source.documents) {
    for (const [key, value] of Object.entries(doc.extractedFields)) {
      if (pattern.test(key) && value.trim()) {
        found.push({
          type: 'profile_field',
          label: key,
          value: maskSensitive(value),
          source: `employee_documents/${doc.id}.extracted_fields.${key}`,
        })
      }
    }
  }
  return found
}

function bankTaxTask(source: FinanceVerificationSource, missingData: string[]): AiLogTaskFacts<FinanceTaskId> {
  const bankDetails = source.financeDetails?.bankAccountNumber
  const bank = bankDetails
    ? financeDetailEvidence(source, ['accountHolder', 'bankAccountNumber', 'bankRoutingCode'])
    : findFields(source, BANK_FIELD)
  const tax = source.financeDetails?.taxId ? financeDetailEvidence(source, ['taxId']) : findFields(source, TAX_FIELD)
  const issues: string[] = []
  const evidence: AiLogEvidence[] = [...bank, ...tax]
  if (bank.length === 0) {
    issues.push('No bank account details are on file — this onboarding flow does not collect them.')
    missingData.push('Bank account details')
    evidence.push({
      type: 'check',
      label: 'Bank account fields',
      value: 'Not found',
      source: `employee_detail_submissions (${source.submission?.id ?? 'none'}) and ${source.documents.length} uploaded document(s)`,
    })
  }
  if (tax.length === 0) {
    issues.push('No tax ID is on file — this onboarding flow does not collect it.')
    missingData.push('Tax ID')
    evidence.push({
      type: 'check',
      label: 'Tax ID fields',
      value: 'Not found',
      source: `employee_detail_submissions (${source.submission?.id ?? 'none'}) and ${source.documents.length} uploaded document(s)`,
    })
  }
  return {
    id: 'bank_tax_details',
    title: 'Bank & tax details',
    status: issues.length === 0 ? 'done' : 'failed',
    actionsTaken: [
      source.submission ? `Read employee detail submission ${source.submission.id}.` : 'Looked for an employee detail submission — none on file.',
      `Searched the extracted fields of ${source.documents.length} uploaded document(s) for bank account and tax ID fields.`,
      ...(source.financeDetails && Object.keys(source.financeDetails).length > 0
        ? [
            `Read the bank/tax details the employee submitted on request (${[
              ...new Set(Object.values(source.financeDetails).map((d) => `employee_finance_details/${d!.recordId}`)),
            ].join(', ')}).`,
          ]
        : []),
    ],
    evidence,
    issues,
    fallbackRecommendation:
      issues.length === 0
        ? 'Confirm the bank and tax details shown match the payroll system.'
        : 'Collect bank account and tax ID details from the employee before the first payroll run.',
  }
}

function payrollTask(source: FinanceVerificationSource, missingData: string[]): AiLogTaskFacts<FinanceTaskId> {
  const { submission } = source
  const offerLetter = source.documents.find((d) => d.documentType === 'offer_letter')
  const actionsTaken: string[] = []
  const evidence: AiLogEvidence[] = []
  const issues: string[] = []
  let failed = false

  if (submission) {
    actionsTaken.push(`Read legal name, role, department and start date from employee detail submission ${submission.id}.`)
    const required: [string, string, string][] = [
      ['Legal name', 'full_name', submission.fullName],
      ['Role', 'role_title', submission.roleTitle],
      ['Department', 'department', submission.department],
      ['Start date', 'start_date', submission.startDate],
    ]
    for (const [label, field, value] of required) {
      evidence.push({ type: 'profile_field', label, value: value || '(empty)', source: submissionSource(source, field) })
      if (!value?.trim()) {
        failed = true
        issues.push(`${label} is missing from the employee's submission.`)
        missingData.push(label)
      }
    }
  } else {
    failed = true
    actionsTaken.push('Looked for an employee detail submission — none on file.')
    issues.push('No employee detail submission is on file, so payroll has no name, role, department or start date.')
    missingData.push('Employee details submission')
  }

  if (offerLetter) {
    actionsTaken.push(`Read the offer letter (${offerLetter.fileName}) and compared it with the submission.`)
    evidence.push(documentEvidence(source, offerLetter))
    const letterName = offerLetter.extractedFields.fullName ?? ''
    const letterStart = offerLetter.extractedFields.startDate ?? ''
    if (submission) {
      const nameMatch = !!letterName && normalize(letterName) === normalize(submission.fullName)
      evidence.push({
        type: 'check',
        label: 'Offer letter name matches profile',
        value: nameMatch ? `Yes — "${letterName}"` : `No — offer letter "${letterName || '(none)'}" vs profile "${submission.fullName}"`,
        source: `employee_documents/${offerLetter.id}.extracted_fields.fullName vs ${submissionSource(source, 'full_name')}`,
      })
      if (!nameMatch) {
        failed = true
        issues.push('The name on the offer letter does not match the employee profile.')
      }
      const startMatch = !!letterStart && letterStart === submission.startDate
      evidence.push({
        type: 'check',
        label: 'Offer letter start date matches profile',
        value: startMatch ? `Yes — ${letterStart}` : `No — offer letter ${letterStart || '(none)'} vs profile ${submission.startDate || '(none)'}`,
        source: `employee_documents/${offerLetter.id}.extracted_fields.startDate vs ${submissionSource(source, 'start_date')}`,
      })
      if (!startMatch) {
        failed = true
        issues.push('The start date on the offer letter does not match the employee profile.')
      }
    }
  } else {
    failed = true
    actionsTaken.push('Looked for an uploaded offer letter — none on file.')
    issues.push('No signed offer letter is on file to confirm role and start date.')
    missingData.push('Offer letter')
  }

  if (submission && source.employee.dateOfJoining) {
    const consistent = source.employee.dateOfJoining === submission.startDate
    evidence.push({
      type: 'check',
      label: 'Start date matches employee record',
      value: consistent
        ? `Yes — ${submission.startDate}`
        : `No — employee record ${source.employee.dateOfJoining} vs submission ${submission.startDate}`,
      source: `employees.date_of_joining (${source.employee.id}) vs ${submissionSource(source, 'start_date')}`,
    })
    if (!consistent) {
      failed = true
      issues.push("The start date in the employee's submission differs from the employee record.")
    }
  }

  const record = source.payrollRecord
  if (record) {
    const createdAt = `${record.createdAt.slice(0, 16).replace('T', ' ')} UTC`
    actionsTaken.push(`Found payroll entry ${record.id}, created by ${record.createdBy} at ${createdAt} from these fields.`)
    evidence.push({
      type: 'record_created',
      label: 'Payroll entry',
      value: `Created ${createdAt} · ${record.payFrequency.replace('_', '-')} pay`,
      source: `payroll_records/${record.id}`,
    })
  } else if (!failed) {
    const bankTaxOnFile = !!source.financeDetails?.bankAccountNumber && !!source.financeDetails?.taxId
    issues.push(
      bankTaxOnFile
        ? 'The payroll entry is drafted from these fields — Finance needs to add compensation and create it.'
        : 'The payroll entry can be created once bank and tax details are on file.',
    )
  }

  return {
    id: 'payroll_entry',
    title: 'Payroll entry',
    status: failed ? 'failed' : record ? 'done' : 'warning',
    blocking: failed,
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation: failed
      ? 'Resolve the missing or mismatched payroll fields with HR before creating the payroll entry.'
      : record
        ? 'Payroll entry is created — no further payroll action needed.'
        : 'Add compensation and create the payroll entry from the drafted fields.',
  }
}

function expenseTask(source: FinanceVerificationSource, missingData: string[]): AiLogTaskFacts<FinanceTaskId> {
  const email = source.submission?.email?.trim() ?? ''
  const bank = source.financeDetails?.bankAccountNumber
  const record = source.expenseAccount
  const issues: string[] = []
  const evidence: AiLogEvidence[] = []
  const actionsTaken: string[] = [
    source.submission
      ? `Read the contact email and department from employee detail submission ${source.submission.id}.`
      : 'Looked for an employee detail submission — none on file.',
  ]
  if (email) {
    evidence.push({ type: 'profile_field', label: 'Contact email', value: email, source: submissionSource(source, 'email') })
  } else {
    issues.push('No contact email is on file to set the expense account up against.')
    missingData.push('Contact email')
  }
  if (bank) {
    actionsTaken.push('Used the bank account the employee submitted as the reimbursement account.')
    evidence.push({
      type: 'profile_field',
      label: 'Reimbursement account',
      value: maskSensitive(bank.value),
      source: `employee_finance_details/${bank.recordId}.bank_account_number`,
    })
  } else {
    issues.push('No bank account is on file to pay expense reimbursements into.')
  }

  if (record) {
    actionsTaken.push(`Found expense account ${record.id}, created by ${record.createdBy} at ${utcStamp(record.createdAt)}.`)
    evidence.push({
      type: 'record_created',
      label: 'Expense account',
      value: `Created ${utcStamp(record.createdAt)} · cost centre ${record.costCenter}`,
      source: `expense_accounts/${record.id}`,
    })
  } else if (email && bank) {
    issues.push(EXPENSE_DRAFTED_ISSUE)
  }

  return {
    id: 'expense_account',
    title: 'Expense account',
    status: !email ? 'failed' : record ? 'done' : 'warning',
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation: record
      ? 'Expense account is created — no further action needed.'
      : email && bank
        ? 'Confirm and create the drafted expense account.'
        : 'Collect the missing contact email or bank details before creating the expense account.',
  }
}

function signoffTask(source: FinanceVerificationSource, others: AiLogTaskFacts<FinanceTaskId>[]): AiLogTaskFacts<FinanceTaskId> {
  const evidence: AiLogEvidence[] = [
    {
      type: 'check',
      label: 'HR directory profile',
      value: source.hrProfileEntryId ? 'Created' : 'Not found',
      source: source.hrProfileEntryId ? `hr_approval_profile_entries/${source.hrProfileEntryId}` : 'hr_approval_profile_entries',
    },
    {
      type: 'check',
      label: 'AI document cross-check',
      value: source.documentCheck?.overallStatus ?? 'Not run',
      source: source.documentCheck ? `document_verification_results/${source.documentCheck.id}` : 'document_verification_results',
    },
  ]
  const issues: string[] = []
  const flagged = others.filter((t) => t.status !== 'done' && t.status !== 'not_applicable')
  if (flagged.length > 0) issues.push(`${flagged.length} finance task(s) need review before sign-off: ${flagged.map((t) => t.title).join(', ')}.`)
  if (!source.hrProfileEntryId) issues.push('HR has not generated the employee directory profile yet.')
  if (source.documentCheck && source.documentCheck.overallStatus !== 'match') {
    issues.push(`The AI document cross-check reported "${source.documentCheck.overallStatus}".`)
  }
  if (!source.documentCheck) issues.push('No AI document cross-check result is on file.')

  const record = source.signoffRecord
  const actionsTaken = [
    'Reviewed the outcome of the bank & tax, payroll and expense account tasks.',
    'Checked for the HR directory profile and the AI document cross-check result.',
  ]
  if (record) {
    actionsTaken.push(`Found sign-off pack ${record.id}, created by ${record.createdBy} at ${utcStamp(record.createdAt)}.`)
    evidence.push({
      type: 'record_created',
      label: 'Finance sign-off pack',
      value: `Created ${utcStamp(record.createdAt)}`,
      source: `finance_signoff_records/${record.id}`,
    })
  } else if (issues.length === 0) {
    issues.push(SIGNOFF_READY_ISSUE)
  }

  const done = !!record && issues.length === 0
  return {
    id: 'finance_signoff',
    title: 'Finance sign-off readiness',
    status: done ? 'done' : 'warning',
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation: done
      ? 'Everything checks out — verify to sign off.'
      : issues.includes(SIGNOFF_READY_ISSUE)
        ? 'Create the sign-off pack, then verify.'
        : 'Review the flagged tasks, then verify with a comment or send back.',
  }
}

export function buildFinanceFacts(source: FinanceVerificationSource): AiLogFacts<FinanceTaskId> {
  const missingData: string[] = []
  const bankTax = bankTaxTask(source, missingData)
  const payroll = payrollTask(source, missingData)
  const expense = expenseTask(source, missingData)
  return {
    tasks: [bankTax, payroll, expense, signoffTask(source, [bankTax, payroll, expense])],
    missingData: [...new Set(missingData)],
  }
}

/** Finance's view rule — see resolveStructuredLogView. */
export function resolveFinanceLogView(roleName: string, requested: string | null): 'full' | 'summary' | null {
  return resolveStructuredLogView('Finance', roleName, requested)
}

const STATUS_WORDS: Record<AiLogOverallStatus, string> = {
  ready: 'is ready for Finance sign-off',
  needs_attention: 'needs Finance attention before sign-off',
  blocked: 'is blocked',
}

export const FINANCE_VERIFICATION_CONFIG: AiVerificationStepConfig<FinanceVerificationSource, FinanceTaskId> = {
  label: 'Finance verification',
  taskIds: FINANCE_TASK_IDS,
  buildFacts: buildFinanceFacts,
  systemPrompt:
    "You are a finance operations assistant. You are given the findings of an automated finance pre-check for a new employee's onboarding: each task's status, evidence and issues were determined by code and are authoritative. Write the HR summary and one recommendation per task for the Finance head. Never invent facts, numbers or records that are not in the findings.",
  fallbackSummary: (facts, overallStatus) => {
    const missing = facts.missingData.length > 0 ? ` Missing: ${facts.missingData.join(', ')}.` : ''
    const flagged = facts.tasks.filter((t) => t.status === 'failed' || t.status === 'warning').length
    return `The finance pre-check ${STATUS_WORDS[overallStatus]}, with ${flagged} of ${facts.tasks.length} tasks flagged.${missing}`
  },
}

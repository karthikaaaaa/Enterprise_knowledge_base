import { GoogleGenAI } from '@google/genai'

/** Everything finance_verification / legal_verification have to go on by the time they're
 * notified — the employee's own submission, the documents they actually uploaded (fields only,
 * never file bytes), the AI cross-check result, and whether HR's directory profile exists. Every
 * field is nullable on purpose: the summary must say what's missing, not paper over it. */
export type DepartmentVerificationInput = {
  fullName: string
  roleTitle: string | null
  department: string | null
  startDate: string | null
  email: string | null
  phone: string | null
  hasAddress: boolean
  /** document_type -> extracted fields, for the documents actually on file. */
  documents: Record<string, Record<string, string>>
  documentCheck: { overallStatus: string; summary: string } | null
  hasHrProfile: boolean
}

const SHARED_RULES =
  'Using only the data provided, write a short 3-5 sentence plain-language summary. Never invent ' +
  'numbers, account details, document names, or facts that are not in the data. If something this ' +
  'review would normally expect is not present in the data, say plainly that it is not on file and ' +
  'needs follow-up — do not assume it is fine. Respond with ONLY the finished summary as flowing ' +
  'prose in a single paragraph — no headings, no bullet points or dashes, no numbered lists.'

const FINANCE_PROMPT =
  'You are a finance operations assistant preparing a pre-check for the Finance head before they ' +
  "verify a new employee's onboarding. Cover: whether bank and tax details are on file (this " +
  'onboarding flow does not collect bank account or tax ID fields, so say so unless they appear in ' +
  'the data), whether payroll entry has what it needs (legal name, role, department, start date, ' +
  'contact details, and an offer letter confirming the role/start date), and whether an expense ' +
  'account can be set up from what is on file. ' +
  SHARED_RULES

const LEGAL_PROMPT =
  'You are a legal operations assistant preparing a pre-check for the Legal head before they verify ' +
  "a new employee's onboarding. Cover: whether a signed offer letter is on file and whether its " +
  'details matched the employee record in the AI document cross-check, whether a government ID is ' +
  'on file for identity/compliance, and whether an NDA or other compliance documents are on file ' +
  '(this onboarding flow has no NDA upload slot, so say it is not on file unless it appears in the ' +
  'data). ' +
  SHARED_RULES

const DOCUMENT_LABELS: Record<string, string> = {
  government_id: 'Government ID',
  offer_letter: 'Offer Letter',
  address_proof: 'Proof of Address',
  photo: 'Photo',
}

function onFile(input: DepartmentVerificationInput, type: string) {
  return type in input.documents
}

function crossCheckSentence(input: DepartmentVerificationInput): string {
  if (!input.documentCheck) return 'No AI document cross-check result is on file.'
  return input.documentCheck.overallStatus === 'match'
    ? 'The AI document cross-check found the uploaded documents consistent with the employee record.'
    : `The AI document cross-check flagged discrepancies (${input.documentCheck.overallStatus}) that should be reviewed.`
}

/** Deterministic, data-driven fallbacks — used when Gemini is unavailable, and built from the same
 * facts so they never claim more than the data supports. */
function financeFallback(input: DepartmentVerificationInput): string {
  const payrollMissing = [
    !input.roleTitle && 'role',
    !input.department && 'department',
    !input.startDate && 'start date',
    !onFile(input, 'offer_letter') && 'offer letter',
  ].filter(Boolean)
  return [
    `Finance pre-check for ${input.fullName}${input.roleTitle ? ` (${input.roleTitle}${input.department ? `, ${input.department}` : ''})` : ''}.`,
    'No bank account or tax ID details have been collected in this onboarding flow, so those must be obtained before the first payroll run.',
    payrollMissing.length === 0
      ? `Payroll entry has the employee's name, role, department, start date${input.startDate ? ` (${input.startDate})` : ''} and a signed offer letter on file.`
      : `Payroll entry is missing: ${payrollMissing.join(', ')}.`,
    input.email
      ? `An expense account can be set up against ${input.email}.`
      : 'No contact email is on file yet for expense account setup.',
    crossCheckSentence(input),
  ].join(' ')
}

function legalFallback(input: DepartmentVerificationInput): string {
  return [
    `Legal pre-check for ${input.fullName}.`,
    onFile(input, 'offer_letter')
      ? 'A signed offer letter is on file.'
      : 'No signed offer letter is on file — this must be obtained before sign-off.',
    onFile(input, 'government_id')
      ? 'A government-issued ID is on file for identity verification.'
      : 'No government-issued ID is on file.',
    'No NDA or other compliance documents have been uploaded in this onboarding flow, so these still need to be collected and signed.',
    crossCheckSentence(input),
  ].join(' ')
}

function toPromptData(input: DepartmentVerificationInput): Record<string, unknown> {
  return {
    full_name: input.fullName,
    role_title: input.roleTitle,
    department: input.department,
    start_date: input.startDate,
    email: input.email,
    phone: input.phone,
    address_on_file: input.hasAddress,
    documents_on_file: Object.fromEntries(
      Object.entries(input.documents).map(([type, fields]) => [DOCUMENT_LABELS[type] ?? type, fields]),
    ),
    documents_not_on_file: Object.keys(DOCUMENT_LABELS)
      .filter((type) => !(type in input.documents))
      .map((type) => DOCUMENT_LABELS[type]),
    ai_document_cross_check: input.documentCheck,
    hr_directory_profile_created: input.hasHrProfile,
  }
}

async function compileSummary(systemPrompt: string, label: string, input: DepartmentVerificationInput, fallback: string) {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: systemPrompt,
      input: `${label} data:\n\n${JSON.stringify(toPromptData(input), null, 2)}`,
      // These prompts carry more data than the other step summaries; with thinking on, 1024 tokens
      // was observed truncating the reply mid-sentence. Low thinking + a bigger cap, and anything
      // short of a 'completed' interaction falls back rather than storing a half-finished summary.
      generation_config: { max_output_tokens: 4096, thinking_level: 'low' },
    })
    const text = response.output_text?.trim()
    if (response.status !== 'completed') {
      console.error(`[v0] Gemini ${label} summary ended with status '${response.status}', using fallback text`)
      return fallback
    }
    return text || fallback
  } catch (error) {
    console.error(`[v0] Gemini ${label} summary failed, using fallback text:`, error)
    return fallback
  }
}

/** The pre-check Fatima (Finance) reviews before clicking Verify on finance_verification. Called
 * once, on Notify (see notifyDepartmentStep in workflow-actions.ts). */
export async function generateFinanceVerificationSummary(input: DepartmentVerificationInput): Promise<{ summaryText: string }> {
  const summaryText = await compileSummary(FINANCE_PROMPT, 'Finance verification', input, financeFallback(input))
  return { summaryText }
}

/** The pre-check Lucas (Legal) reviews before clicking Verify on legal_verification. Called once,
 * on Notify (see notifyDepartmentStep in workflow-actions.ts). */
export async function generateLegalVerificationSummary(input: DepartmentVerificationInput): Promise<{ summaryText: string }> {
  const summaryText = await compileSummary(LEGAL_PROMPT, 'Legal verification', input, legalFallback(input))
  return { summaryText }
}

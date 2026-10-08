import type {
  AiLogEvidence,
  AiLogFacts,
  AiLogOverallStatus,
  AiLogTaskFacts,
  AiVerificationStepConfig,
} from '@/lib/ai-verification-log'

/**
 * legal_verification's structured review log — the same contract as finance_verification's (see
 * lib/ai-verification-log.ts): every status, issue and evidence row is computed here from records;
 * the model only writes the HR summary and per-task recommendations.
 */

export const LEGAL_TASK_IDS = ['offer_letter', 'identity_document', 'confidentiality_agreement', 'legal_signoff'] as const
export type LegalTaskId = (typeof LEGAL_TASK_IDS)[number]

export type LegalVerificationSource = {
  workflowId: string
  employee: { id: string; name: string; dateOfJoining: string | null }
  submission: { id: string; fullName: string; roleTitle: string; department: string; startDate: string } | null
  documents: { id: string; documentType: string; fileName: string; extractedFields: Record<string, string> }[]
  documentCheck: { id: string; overallStatus: string } | null
  /** The confidentiality agreement Legal issued (lib/legal-records.ts), if any. */
  agreement?: {
    id: string
    version: string
    issuedAt: string
    issuedBy: string
    signedName: string | null
    signedAt: string | null
  } | null
  signoffRecord?: { id: string; createdAt: string; createdBy: string } | null
}

/** Issues lib/legal-records.ts filters out to tell "ready to create" apart from "blocked". */
export const AGREEMENT_DRAFTED_ISSUE = 'The confidentiality agreement is drafted from verified records — Legal needs to issue it to the employee.'
export const LEGAL_SIGNOFF_READY_ISSUE = 'Every legal prerequisite is in place — Legal needs to create the compliance sign-off pack.'

/** In-app link that streams the stored document to a Legal/HR viewer (see the documents route). */
export function legalDocumentLink(workflowId: string, documentId: string) {
  return `/api/workflows/${workflowId}/steps/legal_verification/documents/${documentId}`
}

export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function utcStamp(iso: string) {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

function submissionSource(source: LegalVerificationSource, field: string) {
  return `employee_detail_submissions.${field} (${source.submission?.id})`
}

function documentEvidence(source: LegalVerificationSource, doc: LegalVerificationSource['documents'][number], label: string): AiLogEvidence {
  return { type: 'document', label, value: doc.fileName, source: `employee_documents/${doc.id}`, link: legalDocumentLink(source.workflowId, doc.id) }
}

/** One "document field vs profile field" comparison: evidence row plus whether it matched. */
function compare(
  source: LegalVerificationSource,
  doc: LegalVerificationSource['documents'][number],
  docField: string,
  profileField: string,
  profileValue: string,
  label: string,
  normalizeValues = false,
) {
  const docValue = doc.extractedFields[docField] ?? ''
  const match = !!docValue && (normalizeValues ? normalizeName(docValue) === normalizeName(profileValue) : docValue.trim() === profileValue.trim())
  const evidence: AiLogEvidence = {
    type: 'check',
    label,
    value: match ? `Yes — ${docValue}` : `No — document "${docValue || '(none)'}" vs profile "${profileValue || '(none)'}"`,
    source: `employee_documents/${doc.id}.extracted_fields.${docField} vs ${submissionSource(source, profileField)}`,
  }
  return { match, evidence }
}

function offerLetterTask(source: LegalVerificationSource, missingData: string[]): AiLogTaskFacts<LegalTaskId> {
  const doc = source.documents.find((d) => d.documentType === 'offer_letter')
  const evidence: AiLogEvidence[] = []
  const issues: string[] = []
  const actionsTaken: string[] = []
  if (!doc) {
    actionsTaken.push('Looked for an uploaded offer letter — none on file.')
    issues.push('No signed offer letter is on file.')
    missingData.push('Offer letter')
  } else {
    actionsTaken.push(`Read the offer letter (${doc.fileName}) and compared its terms with the employee profile.`)
    evidence.push(documentEvidence(source, doc, 'Offer letter'))
    if (!source.submission) {
      issues.push('No employee detail submission is on file to compare the offer letter against.')
    } else {
      const checks = [
        compare(source, doc, 'fullName', 'full_name', source.submission.fullName, 'Name matches profile', true),
        compare(source, doc, 'roleTitle', 'role_title', source.submission.roleTitle, 'Role matches profile', true),
        compare(source, doc, 'startDate', 'start_date', source.submission.startDate, 'Start date matches profile'),
      ]
      for (const check of checks) {
        evidence.push(check.evidence)
        if (!check.match) issues.push(`Offer letter: ${check.evidence.label.toLowerCase().replace(' matches profile', '')} does not match the employee profile.`)
      }
    }
  }
  return {
    id: 'offer_letter',
    title: 'Signed offer letter',
    status: issues.length === 0 ? 'done' : 'failed',
    blocking: issues.length > 0,
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation:
      issues.length === 0 ? 'Offer letter terms match the profile — no action needed.' : 'Have HR resolve the offer letter discrepancy (revert the upload step if a new letter is needed).',
  }
}

function identityTask(source: LegalVerificationSource, missingData: string[]): AiLogTaskFacts<LegalTaskId> {
  const doc = source.documents.find((d) => d.documentType === 'government_id')
  const evidence: AiLogEvidence[] = []
  const issues: string[] = []
  const actionsTaken: string[] = []
  if (!doc) {
    actionsTaken.push('Looked for an uploaded government ID — none on file.')
    issues.push('No government-issued ID is on file for identity verification.')
    missingData.push('Government ID')
  } else {
    actionsTaken.push(`Read the government ID (${doc.fileName}) and compared the name with the employee profile.`)
    evidence.push(documentEvidence(source, doc, 'Government ID'))
    if (source.submission) {
      const check = compare(source, doc, 'fullName', 'full_name', source.submission.fullName, 'Name on ID matches profile', true)
      evidence.push(check.evidence)
      if (!check.match) issues.push('The name on the government ID does not match the employee profile.')
    } else {
      issues.push('No employee detail submission is on file to compare the ID against.')
    }
  }
  actionsTaken.push('Checked the AI document cross-check result.')
  evidence.push({
    type: 'check',
    label: 'AI document cross-check',
    value: source.documentCheck?.overallStatus ?? 'Not run',
    source: source.documentCheck ? `document_verification_results/${source.documentCheck.id}` : 'document_verification_results',
  })
  if (!source.documentCheck) issues.push('No AI document cross-check result is on file.')
  else if (source.documentCheck.overallStatus !== 'match') issues.push(`The AI document cross-check reported "${source.documentCheck.overallStatus}".`)
  return {
    id: 'identity_document',
    title: 'Identity document',
    status: issues.length === 0 ? 'done' : 'failed',
    blocking: issues.length > 0,
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation:
      issues.length === 0 ? 'Identity is verified — no action needed.' : 'Have HR resolve the identity discrepancy before Legal sign-off.',
  }
}

function agreementTask(
  source: LegalVerificationSource,
  prerequisites: AiLogTaskFacts<LegalTaskId>[],
  missingData: string[],
): AiLogTaskFacts<LegalTaskId> {
  const agreement = source.agreement
  const evidence: AiLogEvidence[] = []
  const issues: string[] = []
  const actionsTaken: string[] = ['Checked for a confidentiality agreement issued to the employee.']
  let status: AiLogTaskFacts['status'] = 'warning'

  if (!agreement) {
    missingData.push('Signed confidentiality agreement')
    const blocked = prerequisites.filter((t) => t.status !== 'done')
    issues.push(
      blocked.length === 0
        ? AGREEMENT_DRAFTED_ISSUE
        : `The agreement can be issued once these are verified: ${blocked.map((t) => t.title).join(', ')}.`,
    )
  } else {
    evidence.push({
      type: 'record_created',
      label: 'Confidentiality agreement',
      value: `Issued ${utcStamp(agreement.issuedAt)} by ${agreement.issuedBy} · ${agreement.version}`,
      source: `legal_agreements/${agreement.id}`,
    })
    if (!agreement.signedAt || !agreement.signedName) {
      actionsTaken.push(`Found agreement ${agreement.id}, issued ${utcStamp(agreement.issuedAt)} — not signed yet.`)
      issues.push("The agreement has been issued and is waiting on the employee's signature.")
      missingData.push('Signed confidentiality agreement')
    } else {
      actionsTaken.push(`Found agreement ${agreement.id}, signed by the employee at ${utcStamp(agreement.signedAt)}.`)
      const nameMatch = !!source.submission && normalizeName(agreement.signedName) === normalizeName(source.submission.fullName)
      evidence.push({
        type: 'check',
        label: 'Signature matches legal name',
        value: nameMatch ? `Yes — "${agreement.signedName}"` : `No — signed "${agreement.signedName}" vs profile "${source.submission?.fullName ?? '(none)'}"`,
        source: `legal_agreements/${agreement.id}.signed_name vs ${submissionSource(source, 'full_name')}`,
      })
      if (nameMatch) {
        status = 'done'
      } else {
        status = 'failed'
        issues.push('The signature does not match the legal name on file.')
      }
    }
  }
  return {
    id: 'confidentiality_agreement',
    title: 'Confidentiality agreement',
    status,
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation: !agreement
      ? 'Issue the drafted confidentiality agreement to the employee.'
      : agreement.signedAt
        ? 'The agreement is signed — no action needed.'
        : 'Wait for the employee to sign, or follow up with them.',
  }
}

function signoffTask(source: LegalVerificationSource, others: AiLogTaskFacts<LegalTaskId>[]): AiLogTaskFacts<LegalTaskId> {
  const issues: string[] = []
  const evidence: AiLogEvidence[] = []
  const flagged = others.filter((t) => t.status !== 'done' && t.status !== 'not_applicable')
  if (flagged.length > 0) issues.push(`${flagged.length} legal task(s) need review before sign-off: ${flagged.map((t) => t.title).join(', ')}.`)
  const record = source.signoffRecord
  const actionsTaken = ['Reviewed the outcome of the offer letter, identity and confidentiality agreement tasks.']
  if (record) {
    actionsTaken.push(`Found compliance sign-off pack ${record.id}, created by ${record.createdBy} at ${utcStamp(record.createdAt)}.`)
    evidence.push({ type: 'record_created', label: 'Compliance sign-off pack', value: `Created ${utcStamp(record.createdAt)}`, source: `legal_signoff_records/${record.id}` })
  } else if (issues.length === 0) {
    issues.push(LEGAL_SIGNOFF_READY_ISSUE)
  }
  const done = !!record && issues.length === 0
  return {
    id: 'legal_signoff',
    title: 'Legal sign-off readiness',
    status: done ? 'done' : 'warning',
    actionsTaken,
    evidence,
    issues,
    fallbackRecommendation: done
      ? 'Everything checks out — verify to sign off.'
      : issues.includes(LEGAL_SIGNOFF_READY_ISSUE)
        ? 'Create the compliance sign-off pack, then verify.'
        : 'Review the flagged tasks, then verify with a comment or send back.',
  }
}

export function buildLegalFacts(source: LegalVerificationSource): AiLogFacts<LegalTaskId> {
  const missingData: string[] = []
  const offer = offerLetterTask(source, missingData)
  const identity = identityTask(source, missingData)
  const agreement = agreementTask(source, [offer, identity], missingData)
  return {
    tasks: [offer, identity, agreement, signoffTask(source, [offer, identity, agreement])],
    missingData: [...new Set(missingData)],
  }
}

const STATUS_WORDS: Record<AiLogOverallStatus, string> = {
  ready: 'is ready for Legal sign-off',
  needs_attention: 'needs Legal attention before sign-off',
  blocked: 'is blocked',
}

export const LEGAL_VERIFICATION_CONFIG: AiVerificationStepConfig<LegalVerificationSource, LegalTaskId> = {
  label: 'Legal verification',
  taskIds: LEGAL_TASK_IDS,
  buildFacts: buildLegalFacts,
  systemPrompt:
    "You are a legal operations assistant. You are given the findings of an automated legal pre-check for a new employee's onboarding: each task's status, evidence and issues were determined by code and are authoritative. Write the HR summary and one recommendation per task for the Legal head. Never invent facts, terms, document names or records that are not in the findings, and never give legal advice beyond the findings.",
  fallbackSummary: (facts, overallStatus) => {
    const missing = facts.missingData.length > 0 ? ` Missing: ${facts.missingData.join(', ')}.` : ''
    const flagged = facts.tasks.filter((t) => t.status === 'failed' || t.status === 'warning').length
    return `The legal pre-check ${STATUS_WORDS[overallStatus]}, with ${flagged} of ${facts.tasks.length} tasks flagged.${missing}`
  },
}

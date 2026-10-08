import {
  getWorkflow,
  getEmployeeByUserId,
  runInTransaction,
  createLegalAgreement,
  getLegalAgreementByWorkflow,
  signLegalAgreement,
  createLegalSignoffRecord,
  getLegalSignoffRecordByWorkflow,
  type LegalAgreement,
  type LegalSignoffRecord,
} from '@/lib/workflow-store'
import { compileLegalVerificationSource } from '@/lib/workflow-actions'
import {
  AGREEMENT_DRAFTED_ISSUE,
  LEGAL_SIGNOFF_READY_ISSUE,
  buildLegalFacts,
  normalizeName,
  type LegalVerificationSource,
} from '@/lib/legal-verification-log'
import { renderConfidentialityAgreement } from '@/lib/legal-agreement-template'
import { approvalAwaiting, latestRunIdFor, notifyRoleAbout, rerunAfter, type RecordOptions, type RerunOutcome } from '@/lib/structured-review'

/**
 * Records legal_verification creates — the same draft-then-confirm pattern as finance's:
 *   - Confidentiality agreement: rendered from a fixed template with verified fields once the offer
 *     letter and identity checks pass; Legal issues it; the employee signs by typing their legal
 *     name (which must match the profile). The AI never writes agreement terms.
 *   - Compliance sign-off pack: snapshot of everything Legal is signing off on, once every other
 *     legal task is done.
 * Each change re-runs the legal AI review. Reverting legal_verification deletes both
 * (deleteLegalVerificationArtifactsForWorkflow).
 */

const STEP_KEY = 'legal_verification'

export type CreateLegalRecordError = 'workflow_not_found' | 'not_awaiting_legal' | 'already_created' | 'not_ready'

// ---------- Confidentiality agreement ----------

export type AgreementDraft = {
  ready: boolean
  blockers: string[]
  preview: { title: string; version: string; body: string } | null
}

/** Pure: the agreement Legal would issue, and what (if anything) stops it being issued. */
export function buildAgreementDraft(source: LegalVerificationSource): AgreementDraft {
  const task = buildLegalFacts(source).tasks.find((t) => t.id === 'confidentiality_agreement')!
  const blockers = source.agreement ? [] : task.issues.filter((issue) => issue !== AGREEMENT_DRAFTED_ISSUE)
  const submission = source.submission
  if (!submission) blockers.unshift('No employee detail submission is on file.')
  return {
    ready: !source.agreement && blockers.length === 0,
    blockers,
    preview: submission
      ? renderConfidentialityAgreement({
          employeeName: submission.fullName,
          roleTitle: submission.roleTitle,
          department: submission.department,
          startDate: submission.startDate,
        })
      : null,
  }
}

export function getAgreementDraft(workflowId: string) {
  return { draft: buildAgreementDraft(compileLegalVerificationSource(workflowId)), record: getLegalAgreementByWorkflow(workflowId) }
}

export async function issueAgreement(
  workflowId: string,
  issuedByUserId: string,
  options: RecordOptions = {},
): Promise<{ ok: true; record: LegalAgreement; rerun: RerunOutcome } | { ok: false; error: CreateLegalRecordError; message?: string }> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaiting(workflowId, STEP_KEY)
  if (!approval) return { ok: false, error: 'not_awaiting_legal' }
  if (getLegalAgreementByWorkflow(workflowId)) return { ok: false, error: 'already_created' }

  const { draft } = getAgreementDraft(workflowId)
  if (!draft.ready || !draft.preview) return { ok: false, error: 'not_ready', message: draft.blockers.join(' ') }
  const preview = draft.preview

  const record = runInTransaction(() => {
    const created = createLegalAgreement({
      workflowId,
      employeeId: workflow.employeeId,
      agreementType: 'confidentiality',
      title: preview.title,
      version: preview.version,
      body: preview.body,
      issuedBy: issuedByUserId,
      sourceRunId: latestRunIdFor(approval.id, STEP_KEY),
    })
    notifyRoleAbout('HR', approval.id, `${preview.title} issued — waiting on the employee's signature`)
    return created
  })
  return { ok: true, record, rerun: await rerunAfter(workflowId, STEP_KEY, issuedByUserId, options) }
}

/** What the employee sees on their own page: an issued, still-unsigned agreement. */
export function getAgreementToSign(workflowId: string) {
  const agreement = getLegalAgreementByWorkflow(workflowId)
  return agreement && !agreement.signedAt
    ? { id: agreement.id, title: agreement.title, version: agreement.version, body: agreement.body, issuedAt: agreement.issuedAt }
    : null
}

export type SignAgreementError = 'workflow_not_found' | 'forbidden' | 'not_found' | 'already_signed' | 'consent_required' | 'name_mismatch'

export async function signAgreement(
  workflowId: string,
  agreementId: string,
  signedByUserId: string,
  input: { signedName: unknown; consent: unknown },
  options: RecordOptions = {},
): Promise<{ ok: true; rerun: RerunOutcome } | { ok: false; error: SignAgreementError }> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }
  // Only the employee the workflow belongs to — never HR or Legal on their behalf.
  const employee = getEmployeeByUserId(signedByUserId)
  if (!employee || employee.id !== workflow.employeeId) return { ok: false, error: 'forbidden' }

  const agreement = getLegalAgreementByWorkflow(workflowId)
  if (!agreement || agreement.id !== agreementId) return { ok: false, error: 'not_found' }
  if (agreement.signedAt) return { ok: false, error: 'already_signed' }
  if (input.consent !== true) return { ok: false, error: 'consent_required' }

  const signedName = typeof input.signedName === 'string' ? input.signedName.trim().replace(/\s+/g, ' ') : ''
  const legalName = compileLegalVerificationSource(workflowId).submission?.fullName ?? ''
  if (!signedName || !legalName || normalizeName(signedName) !== normalizeName(legalName)) {
    return { ok: false, error: 'name_mismatch' }
  }

  const signed = runInTransaction(() => {
    if (!signLegalAgreement(agreement.id, { signedName, signedBy: signedByUserId })) return false
    const approval = approvalAwaiting(workflowId, STEP_KEY)
    notifyRoleAbout('Legal', approval?.id ?? null, `${signedName} signed the ${agreement.title}`)
    notifyRoleAbout('HR', approval?.id ?? null, `${signedName} signed the ${agreement.title}`)
    return true
  })
  if (!signed) return { ok: false, error: 'already_signed' }
  return { ok: true, rerun: await rerunAfter(workflowId, STEP_KEY, signedByUserId, options) }
}

// ---------- Compliance sign-off pack ----------

export type LegalSignoffDraft = { ready: boolean; blockers: string[]; snapshot: Record<string, string | null> }

/** Pure: ready once the offer letter, identity and signed agreement are all done. */
export function buildLegalSignoffDraft(source: LegalVerificationSource): LegalSignoffDraft {
  const task = buildLegalFacts(source).tasks.find((t) => t.id === 'legal_signoff')!
  const blockers = task.issues.filter((issue) => issue !== LEGAL_SIGNOFF_READY_ISSUE)
  const offer = source.documents.find((d) => d.documentType === 'offer_letter')
  const id = source.documents.find((d) => d.documentType === 'government_id')
  return {
    ready: blockers.length === 0 && !!source.agreement?.signedAt,
    blockers,
    snapshot: {
      offerLetterDocumentId: offer?.id ?? null,
      governmentIdDocumentId: id?.id ?? null,
      documentCheckId: source.documentCheck?.id ?? null,
      documentCheckStatus: source.documentCheck?.overallStatus ?? null,
      agreementId: source.agreement?.id ?? null,
      agreementVersion: source.agreement?.version ?? null,
      agreementSignedAt: source.agreement?.signedAt ?? null,
      submissionId: source.submission?.id ?? null,
    },
  }
}

export function getLegalSignoffDraft(workflowId: string) {
  return { draft: buildLegalSignoffDraft(compileLegalVerificationSource(workflowId)), record: getLegalSignoffRecordByWorkflow(workflowId) }
}

export async function createLegalSignoffPack(
  workflowId: string,
  createdByUserId: string,
  options: RecordOptions = {},
): Promise<{ ok: true; record: LegalSignoffRecord; rerun: RerunOutcome } | { ok: false; error: CreateLegalRecordError; message?: string }> {
  if (!getWorkflow(workflowId)) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaiting(workflowId, STEP_KEY)
  if (!approval) return { ok: false, error: 'not_awaiting_legal' }
  if (getLegalSignoffRecordByWorkflow(workflowId)) return { ok: false, error: 'already_created' }

  const { draft } = getLegalSignoffDraft(workflowId)
  if (!draft.ready) return { ok: false, error: 'not_ready', message: draft.blockers.join(' ') }

  const record = runInTransaction(() => {
    const created = createLegalSignoffRecord({
      workflowId,
      snapshot: draft.snapshot,
      sourceRunId: latestRunIdFor(approval.id, STEP_KEY),
      createdBy: createdByUserId,
    })
    notifyRoleAbout('HR', approval.id, 'Legal compliance sign-off pack created — ready for Legal to verify')
    return created
  })
  return { ok: true, record, rerun: await rerunAfter(workflowId, STEP_KEY, createdByUserId, options) }
}

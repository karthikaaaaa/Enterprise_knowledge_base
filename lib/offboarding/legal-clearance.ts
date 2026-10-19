import { getUserById, runInTransaction } from '@/lib/workflow-store'
import { approvalAwaiting, notifyRoleAbout, rerunAfter, type RecordOptions, type RerunOutcome } from '@/lib/structured-review'
import { loadOffboarding, stepOf, departmentHead } from '@/lib/offboarding/context'
import { recordWorkflowEvent } from '@/lib/offboarding/store'
import { legalClearanceRecords, legalConfirmationsFor, type LegalConfirmationTask } from '@/lib/offboarding/reviews'

/**
 * Legal Clearance: when the records can't settle a task — no signed confidentiality agreement on
 * file, or no offer letter with non-compete / notice clauses — Legal confirms it by hand:
 * the employee acknowledged their confidentiality obligations at exit, or Legal reviewed the
 * contract and records whether any restrictive covenants apply. The review uses the confirmation in
 * place of the warning (lib/offboarding/reviews.ts buildLegalClearanceFacts); a record on file
 * always wins. Reverting Legal Clearance clears the confirmations.
 */

const STEP_KEY = 'legal_clearance'

export type LegalClearanceError = 'workflow_not_found' | 'not_awaiting_legal' | 'not_allowed' | 'already_on_record' | 'invalid_input'

export function getLegalClearanceState(workflowId: string) {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return null
  const { signed, clauseFields } = legalClearanceRecords(ctx)
  return {
    /** Which tasks the records can't settle, so Legal has to confirm them. */
    needs: { confidentiality_obligations: signed.length === 0, restrictive_covenants: clauseFields.length === 0 },
    confirmations: legalConfirmationsFor(workflowId),
    canConfirm: !!approvalAwaiting(workflowId, STEP_KEY),
  }
}

export async function confirmLegalClearance(
  workflowId: string,
  userId: string,
  input: { task: unknown; clausesApply?: unknown; clauses?: unknown; note?: unknown },
  options: RecordOptions = {},
): Promise<{ ok: true; rerun: RerunOutcome } | { ok: false; error: LegalClearanceError; message?: string }> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return { ok: false, error: 'workflow_not_found' }
  const approval = approvalAwaiting(workflowId, STEP_KEY)
  if (!approval) return { ok: false, error: 'not_awaiting_legal' }
  // The assigned Legal approver, or the Legal head.
  const head = departmentHead(stepOf(ctx, STEP_KEY)!.departmentName)
  if (approval.approverId && approval.approverId !== userId && head?.id !== userId) return { ok: false, error: 'not_allowed' }

  if (input.task !== 'confidentiality_obligations' && input.task !== 'restrictive_covenants') return { ok: false, error: 'invalid_input', message: 'Unknown task' }
  const task: LegalConfirmationTask = input.task
  const { signed, clauseFields } = legalClearanceRecords(ctx)
  if (task === 'confidentiality_obligations' ? signed.length > 0 : clauseFields.length > 0) return { ok: false, error: 'already_on_record' }

  let clausesApply: boolean | null = null
  let clauses: string | null = null
  if (task === 'restrictive_covenants') {
    if (typeof input.clausesApply !== 'boolean') return { ok: false, error: 'invalid_input', message: 'Say whether any non-compete / notice clauses apply' }
    clausesApply = input.clausesApply
    if (clausesApply) {
      clauses = typeof input.clauses === 'string' ? input.clauses.trim().replace(/\s+/g, ' ').slice(0, 500) : ''
      if (!clauses) return { ok: false, error: 'invalid_input', message: 'Describe the clauses that apply' }
    }
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().replace(/\s+/g, ' ').slice(0, 300) : null
  const confirmedByName = getUserById(userId)?.name ?? 'Legal'

  const summary =
    task === 'confidentiality_obligations'
      ? 'the employee acknowledged their confidentiality obligations'
      : clausesApply
        ? `restrictive covenants apply: ${clauses}`
        : 'no restrictive covenants apply'
  runInTransaction(() => {
    recordWorkflowEvent({ workflowId, stepKey: STEP_KEY, action: 'legal_confirmed', detail: { task, clausesApply, clauses, note, confirmedByName }, performedBy: userId })
    notifyRoleAbout('HR', approval.id, `Legal confirmed for ${ctx.name}: ${summary}`)
  })
  return { ok: true, rerun: await rerunAfter(workflowId, STEP_KEY, userId, options) }
}

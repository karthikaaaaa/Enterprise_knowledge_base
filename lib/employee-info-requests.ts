import {
  getWorkflow,
  getWorkflowSteps,
  getEmployeeById,
  getEmployeeByUserId,
  getRoleByName,
  getUserById,
  listAiVerificationRuns,
  createEmployeeInfoRequest,
  getEmployeeInfoRequest,
  listEmployeeInfoRequests,
  markEmployeeInfoRequestFulfilled,
  createEmployeeFinanceDetails,
  createNotification,
  runInTransaction,
  type EmployeeInfoRequest,
} from '@/lib/workflow-store'
import { getLatestApprovalForStep } from '@/lib/workflow-view'
import { rerunFinanceVerification } from '@/lib/workflow-actions'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import {
  INFO_REQUEST_ITEMS,
  INFO_REQUEST_MAX_FILE_BYTES,
  isInfoRequestItemKey,
  canRequestFromRun,
  type InfoRequestFieldKey,
  type InfoRequestItemKey,
} from '@/lib/info-request-items'

/**
 * "Request info from employee": closes the loop on a Finance send-back caused by missing data.
 *   1. Finance sends the review back (task-actions.ts sendBackDepartmentReview).
 *   2. HR asks the employee for the missing items (requestEmployeeInfo).
 *   3. The employee answers on their own onboarding page (submitEmployeeInfo), which stores the
 *      details, notifies HR + Finance, and re-runs the finance AI so Fatima's next run already
 *      reflects them.
 * Only finance_verification uses this today.
 */

const STEP_KEY = 'finance_verification'
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
const MAX_MESSAGE_LENGTH = 1000

function employeeName(workflowId: string) {
  const workflow = getWorkflow(workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  return employee ? `${employee.firstName} ${employee.lastName}` : 'the employee'
}

function itemLabels(items: string[]) {
  return items.map((key) => (isInfoRequestItemKey(key) ? INFO_REQUEST_ITEMS[key].label : key)).join(', ')
}

function notifyRole(roleName: string, message: string) {
  const role = getRoleByName(roleName)
  if (role) createNotification({ roleId: role.id, message })
}

export function getOpenInfoRequest(workflowId: string): EmployeeInfoRequest | null {
  return listEmployeeInfoRequests(workflowId, STEP_KEY).find((r) => r.status === 'open') ?? null
}

export function getLatestInfoRequest(workflowId: string): EmployeeInfoRequest | null {
  return listEmployeeInfoRequests(workflowId, STEP_KEY)[0] ?? null
}

/** What HR and Finance see about the latest request (no submitted values — those are only ever
 * shown masked, as evidence in the finance run). */
export function describeInfoRequest(request: EmployeeInfoRequest) {
  return {
    id: request.id,
    status: request.status,
    items: request.requestedItems,
    itemLabels: itemLabels(request.requestedItems),
    message: request.message,
    requestedBy: getUserById(request.requestedBy)?.name ?? 'Unknown user',
    requestedAt: request.requestedAt,
    fulfilledAt: request.fulfilledAt,
  }
}

export type InfoRequestSummary = ReturnType<typeof describeInfoRequest>

// ---------- HR: raise a request ----------

export type RequestInfoError =
  | 'workflow_not_found'
  | 'step_not_found'
  | 'not_awaiting_finance'
  | 'nothing_to_request'
  | 'request_already_open'
  | 'invalid_items'
  | 'message_too_long'

export function requestEmployeeInfo(
  workflowId: string,
  requestedByUserId: string,
  input: { items: unknown; message?: unknown },
): { ok: true; request: EmployeeInfoRequest } | { ok: false; error: RequestInfoError } {
  if (!getWorkflow(workflowId)) return { ok: false, error: 'workflow_not_found' }
  const step = getWorkflowSteps(workflowId).find((s) => s.stepName === STEP_KEY)
  if (!step) return { ok: false, error: 'step_not_found' }
  const approval = getLatestApprovalForStep(workflowId, step.id)
  if (!approval || approval.status === 'completed' || approval.status === 'verified') {
    return { ok: false, error: 'not_awaiting_finance' }
  }
  const latestRun = listAiVerificationRuns(approval.id, STEP_KEY)[0]
  // As soon as the run flags missing data the employee can provide — HR doesn't have to wait for
  // Finance to send it back first.
  const missingData = (latestRun?.result as { missingData?: unknown } | undefined)?.missingData
  if (
    !latestRun ||
    !canRequestFromRun({
      missingData: Array.isArray(missingData) ? missingData.filter((m): m is string => typeof m === 'string') : [],
      reviewAction: latestRun.reviewAction,
    })
  ) {
    return { ok: false, error: 'nothing_to_request' }
  }
  if (getOpenInfoRequest(workflowId)) return { ok: false, error: 'request_already_open' }

  if (!Array.isArray(input.items) || input.items.length === 0 || !input.items.every(isInfoRequestItemKey)) {
    return { ok: false, error: 'invalid_items' }
  }
  const items = [...new Set(input.items as InfoRequestItemKey[])]
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim() : null
  if (message && message.length > MAX_MESSAGE_LENGTH) return { ok: false, error: 'message_too_long' }

  const request = runInTransaction(() => {
    const created = createEmployeeInfoRequest({
      workflowId,
      stepKey: STEP_KEY,
      sourceRunId: latestRun.id,
      requestedItems: items,
      message,
      requestedBy: requestedByUserId,
    })
    notifyRole('Finance', `HR asked ${employeeName(workflowId)} for: ${itemLabels(items)}`)
    return created
  })
  return { ok: true, request }
}

// ---------- Employee: answer it ----------

export type SubmitInfoError =
  | 'workflow_not_found'
  | 'forbidden'
  | 'request_not_found'
  | 'request_not_open'
  | 'invalid_field'
  | 'invalid_file'

export type SubmitInfoInput = {
  fields: Partial<Record<InfoRequestFieldKey, unknown>>
  file?: { fileName: string; mimeType: string; dataBase64: string } | null
}

export type SubmitInfoOptions = {
  generate?: NarrativeGenerator
  /** Runs the finance AI re-run off the request path (the route passes Next's `after`) so the
   * employee isn't left waiting on the model. Omitted, the re-run is awaited inline (tests). */
  defer?: (task: () => Promise<void>) => void
}

export async function submitEmployeeInfo(
  workflowId: string,
  requestId: string,
  submittedByUserId: string,
  input: SubmitInfoInput,
  options: SubmitInfoOptions = {},
): Promise<
  | { ok: true; responseId: string; rerun: 'done' | 'skipped' | 'scheduled' }
  | { ok: false; error: SubmitInfoError; message?: string }
> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }
  // Only the employee the workflow belongs to can answer — never HR on their behalf.
  const employee = getEmployeeByUserId(submittedByUserId)
  if (!employee || employee.id !== workflow.employeeId) return { ok: false, error: 'forbidden' }

  const request = getEmployeeInfoRequest(requestId)
  if (!request || request.workflowId !== workflowId) return { ok: false, error: 'request_not_found' }
  if (request.status !== 'open') return { ok: false, error: 'request_not_open' }

  const values: Partial<Record<InfoRequestFieldKey, string>> = {}
  for (const itemKey of request.requestedItems) {
    if (!isInfoRequestItemKey(itemKey)) continue
    for (const field of INFO_REQUEST_ITEMS[itemKey].fields) {
      const raw = input.fields[field.key]
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) return { ok: false, error: 'invalid_field', message: `${field.label} is required` }
      if (!field.pattern.test(value)) return { ok: false, error: 'invalid_field', message: `${field.label}: ${field.patternHint}` }
      values[field.key] = value
    }
  }

  const file = input.file ?? null
  if (file) {
    if (!file.fileName.trim() || !ALLOWED_FILE_TYPES.has(file.mimeType)) {
      return { ok: false, error: 'invalid_file', message: 'Attach a PDF, PNG, JPEG or WebP file' }
    }
    if (Math.floor((file.dataBase64.length * 3) / 4) > INFO_REQUEST_MAX_FILE_BYTES) {
      return { ok: false, error: 'invalid_file', message: 'File is too large (max 8MB)' }
    }
  }

  const name = employeeName(workflowId)
  const responseId = runInTransaction(() => {
    const details = createEmployeeFinanceDetails({
      workflowId,
      employeeId: employee.id,
      requestId,
      accountHolder: values.accountHolder ?? null,
      bankAccountNumber: values.bankAccountNumber ?? null,
      bankRoutingCode: values.bankRoutingCode ?? null,
      taxId: values.taxId ?? null,
      fileName: file?.fileName.trim() ?? null,
      fileMimeType: file?.mimeType ?? null,
      fileData: file?.dataBase64 ?? null,
      submittedBy: submittedByUserId,
    })
    markEmployeeInfoRequestFulfilled(requestId, { fulfilledBy: submittedByUserId, responseId: details.id })
    const message = `${name} submitted the requested ${itemLabels(request.requestedItems)}`
    notifyRole('HR', message)
    notifyRole('Finance', `${message} — the finance AI review is being re-run with them`)
    return details.id
  })

  // Outside the transaction: the model call is async and slow. If Finance's step has moved on
  // (reverted, or already verified) there's nothing to re-run — the details are still stored and
  // the next Notify/Re-run picks them up.
  const rerun = async () => {
    const result = await rerunFinanceVerification(workflowId, submittedByUserId, options.generate)
    if (!result.ok) console.warn(`[info-request] ${requestId}: finance re-run skipped (${result.error})`)
    return result.ok
  }
  if (options.defer) {
    options.defer(async () => void (await rerun()))
    return { ok: true, responseId, rerun: 'scheduled' }
  }
  return { ok: true, responseId, rerun: (await rerun()) ? 'done' : 'skipped' }
}

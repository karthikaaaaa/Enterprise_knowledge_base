import {
  createEmployeeInfoRequest,
  getEmployeeByUserId,
  getEmployeeInfoRequest,
  getRoleByName,
  getUserById,
  listAiVerificationRuns,
  listEmployeeInfoRequests,
  markEmployeeInfoRequestFulfilled,
  createNotification,
  runInTransaction,
  type EmployeeInfoRequest,
} from '@/lib/workflow-store'
import type { NarrativeGenerator } from '@/lib/ai-verification-log'
import { loadOffboarding, approvalOf, exitDetailsFor, type OffboardingContext } from '@/lib/offboarding/context'
import { applyExitDetailChanges, recordWorkflowEvent } from '@/lib/offboarding/store'
import { generateHrExitPrecheck } from '@/lib/offboarding/actions'
import {
  EXIT_DETAIL_FIELDS,
  employeeMayProvideExitDetails,
  isExitDetailFieldKey,
  requestableExitFields,
  validateExitDetailValues,
  type ExitDetailFieldKey,
} from '@/lib/offboarding/exit-detail-fields'

/**
 * "Request details from employee" on HR Exit Approval — the offboarding twin of onboarding's
 * finance request (lib/employee-info-requests.ts), on the same employee_info_requests table:
 *   1. The HR exit pre-check flags missing data the employee can provide.
 *   2. HR requests it (requestExitDetails) — the exiting employee gets an in-app notification
 *      listing exactly those fields; HR can re-notify while it's open.
 *   3. The employee answers on their own offboarding page (submitExitDetails): the values are saved
 *      to the exit details record (audit-logged per field), HR is notified, and the pre-check is
 *      re-run so HR's next look already reflects them.
 * Terminations never get the form — HR fills those in with Edit exit details.
 */

export const EXIT_REQUEST_STEP_KEY = 'hr_exit_approval'
const MAX_MESSAGE_LENGTH = 1000

export type ExitRequestError = 'workflow_not_found' | 'not_allowed' | 'invalid_input' | 'wrong_state'
type Fail = { ok: false; error: ExitRequestError; message?: string }

function fail(error: ExitRequestError, message?: string): Fail {
  return { ok: false, error, message }
}

function fieldLabels(fields: string[], employee = false) {
  return fields
    .filter(isExitDetailFieldKey)
    .map((key) => (employee ? EXIT_DETAIL_FIELDS[key].employeeLabel : EXIT_DETAIL_FIELDS[key].label))
    .join(', ')
}

function notifyEmployee(ctx: OffboardingContext, message: string) {
  const role = getRoleByName('Employee')
  if (role && ctx.user) createNotification({ roleId: role.id, recipientUserId: ctx.user.id, message })
}

function notifyHr(message: string) {
  const role = getRoleByName('HR')
  if (role) createNotification({ roleId: role.id, message })
}

export function getOpenExitInfoRequest(workflowId: string): EmployeeInfoRequest | null {
  return listEmployeeInfoRequests(workflowId, EXIT_REQUEST_STEP_KEY).find((r) => r.status === 'open') ?? null
}

export function getLatestExitInfoRequest(workflowId: string): EmployeeInfoRequest | null {
  return listEmployeeInfoRequests(workflowId, EXIT_REQUEST_STEP_KEY)[0] ?? null
}

export function describeExitInfoRequest(request: EmployeeInfoRequest) {
  return {
    id: request.id,
    status: request.status,
    fields: request.requestedItems.filter(isExitDetailFieldKey),
    fieldLabels: fieldLabels(request.requestedItems),
    message: request.message,
    requestedBy: getUserById(request.requestedBy)?.name ?? 'Unknown user',
    requestedAt: request.requestedAt,
    fulfilledAt: request.fulfilledAt,
  }
}

/** The latest pre-check run's missingData while HR Exit Approval is still open (else null). */
export function latestHrExitMissingData(ctx: OffboardingContext): { runId: string; missingData: string[] } | null {
  const approval = approvalOf(ctx, 'hr_exit_approval')
  if (!approval || approval.status !== 'allocated') return null
  const run = listAiVerificationRuns(approval.id, EXIT_REQUEST_STEP_KEY)[0]
  if (!run) return null
  const missing = (run.result as { missingData?: unknown }).missingData
  return { runId: run.id, missingData: Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : [] }
}

/** Fields HR can ask for right now — what the latest run flags, minus anything already asked for
 * in an open request. Empty for a termination. */
export function requestableFieldsNow(ctx: OffboardingContext): ExitDetailFieldKey[] {
  const latest = latestHrExitMissingData(ctx)
  if (!latest) return []
  return requestableExitFields(latest.missingData, exitDetailsFor(ctx).exitType)
}

// ---------- HR: raise / re-notify ----------

export function requestExitDetails(
  workflowId: string,
  hrUserId: string,
  input: { fields?: unknown; message?: unknown } = {},
): { ok: true; request: EmployeeInfoRequest } | Fail {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const latest = latestHrExitMissingData(ctx)
  if (!latest) return fail('wrong_state', 'Generate the AI pre-check first')
  const details = exitDetailsFor(ctx)
  if (!employeeMayProvideExitDetails(details.exitType)) {
    return fail('not_allowed', 'This is a termination — the employee does not provide exit details. Use Edit exit details.')
  }
  if (getOpenExitInfoRequest(workflowId)) return fail('wrong_state', 'A request is already waiting on the employee — re-notify them instead')

  const suggested = requestableExitFields(latest.missingData, details.exitType)
  let fields: ExitDetailFieldKey[] = suggested
  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields) || !input.fields.every(isExitDetailFieldKey)) return fail('invalid_input', 'Unknown field requested')
    fields = [...new Set(input.fields as ExitDetailFieldKey[])]
  }
  if (fields.length === 0) return fail('invalid_input', 'Nothing the employee can provide is missing')
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim() : null
  if (message && message.length > MAX_MESSAGE_LENGTH) return fail('invalid_input', 'Keep the note under 1000 characters')

  const request = runInTransaction(() => {
    const created = createEmployeeInfoRequest({
      workflowId,
      stepKey: EXIT_REQUEST_STEP_KEY,
      sourceRunId: latest.runId,
      requestedItems: fields,
      message,
      requestedBy: hrUserId,
    })
    notifyEmployee(ctx, `HR needs a few details to process your exit: ${fieldLabels(fields, true)}`)
    recordWorkflowEvent({ workflowId, stepKey: EXIT_REQUEST_STEP_KEY, action: 'exit_details_requested', detail: { fields, requestId: created.id }, performedBy: hrUserId })
    return created
  })
  return { ok: true, request }
}

export function renotifyExitDetailsRequest(workflowId: string, hrUserId: string): { ok: true } | Fail {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  const open = getOpenExitInfoRequest(workflowId)
  if (!open) return fail('wrong_state', 'There is no open request to re-notify')
  runInTransaction(() => {
    notifyEmployee(ctx, `Reminder — HR still needs these details to process your exit: ${fieldLabels(open.requestedItems, true)}`)
    recordWorkflowEvent({ workflowId, stepKey: EXIT_REQUEST_STEP_KEY, action: 'exit_details_re_notified', detail: { requestId: open.id }, performedBy: hrUserId })
  })
  return { ok: true }
}

// ---------- Employee: answer it ----------

export type SubmitExitDetailsOptions = {
  generate?: NarrativeGenerator
  /** Runs the pre-check re-run after the response (the route passes Next's `after`). Omitted, it's
   * awaited inline (tests). */
  defer?: (task: () => Promise<void>) => void
}

export async function submitExitDetails(
  workflowId: string,
  requestId: string,
  employeeUserId: string,
  input: { fields?: unknown },
  options: SubmitExitDetailsOptions = {},
): Promise<{ ok: true; rerun: 'done' | 'skipped' | 'scheduled' } | Fail> {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return fail('workflow_not_found')
  // Only the exiting employee themself — never HR on their behalf (HR uses Edit exit details).
  if (getEmployeeByUserId(employeeUserId)?.id !== ctx.employee.id) return fail('not_allowed')
  const details = exitDetailsFor(ctx)
  if (!employeeMayProvideExitDetails(details.exitType)) return fail('not_allowed', 'HR records the details for this exit')

  const request = getEmployeeInfoRequest(requestId)
  if (!request || request.workflowId !== workflowId || request.stepKey !== EXIT_REQUEST_STEP_KEY) return fail('invalid_input', 'Request not found')
  if (request.status !== 'open') return fail('wrong_state', 'This request has already been answered')

  const raw = (input.fields && typeof input.fields === 'object' ? input.fields : {}) as Record<string, unknown>
  // Only the requested fields are accepted — anything else in the body (exit type included) is ignored.
  const values: Partial<Record<ExitDetailFieldKey, string>> = {}
  for (const key of request.requestedItems.filter(isExitDetailFieldKey)) {
    const value = typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
    if (!value) return fail('invalid_input', `${EXIT_DETAIL_FIELDS[key].employeeLabel} is required`)
    values[key] = value
  }
  const problem = validateExitDetailValues(values, {
    lastWorkingDay: values.lastWorkingDay ?? details.lastWorkingDay,
    noticeStartDate: values.noticeStartDate ?? details.noticeStartDate,
  })
  if (problem) return fail('invalid_input', problem)

  runInTransaction(() => {
    applyExitDetailChanges(workflowId, values, { source: 'employee', userId: employeeUserId })
    markEmployeeInfoRequestFulfilled(requestId, { fulfilledBy: employeeUserId, responseId: `exit_details/${workflowId}` })
    notifyHr(`${ctx.name} submitted the requested exit details (${fieldLabels(Object.keys(values))}) — the HR exit pre-check is being re-run with them`)
  })

  // Outside the transaction: the model call is slow. If HR Exit Approval has moved on (approved or
  // reverted) there's nothing to re-run — the details are stored and the next pre-check reads them.
  const rerun = async () => {
    const fresh = loadOffboarding(workflowId)
    if (!fresh || approvalOf(fresh, 'hr_exit_approval')?.status !== 'allocated') return false
    const result = await generateHrExitPrecheck(workflowId, employeeUserId, options.generate)
    if (!result.ok) console.warn(`[exit-info-request] ${requestId}: pre-check re-run skipped (${result.error})`)
    return result.ok
  }
  if (options.defer) {
    options.defer(async () => void (await rerun()))
    return { ok: true, rerun: 'scheduled' }
  }
  return { ok: true, rerun: (await rerun()) ? 'done' : 'skipped' }
}

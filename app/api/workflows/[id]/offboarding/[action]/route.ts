import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { requestExitDetails, renotifyExitDetailsRequest, submitExitDetails } from '@/lib/offboarding/exit-info-requests'
import {
  hrEditExitDetails,
  notifyOffboardingStep,
  renotifyOffboardingStep,
  managerExitDecision,
  generateHrExitPrecheck,
  hrExitApprove,
  hrExitSendBack,
  confirmHandover,
  acceptHandover,
  markAsset,
  completeAssetRecovery,
  markExitComplete,
  type OffboardingError,
  type Result,
} from '@/lib/offboarding/actions'

const ERROR_STATUS: Record<OffboardingError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  step_locked: 409,
  already_notified: 409,
  not_notifiable: 400,
  manager_required: 409,
  not_allowed: 403,
  invalid_input: 400,
  wrong_state: 409,
  review_required: 400,
  blocked: 409,
}

const DEFAULT_MESSAGE: Record<OffboardingError, string> = {
  workflow_not_found: 'Offboarding workflow not found',
  step_not_found: 'Step not found on this workflow',
  step_locked: 'Complete and verify the previous step first',
  already_notified: 'This step has already been notified',
  not_notifiable: 'This step has no owner to notify',
  manager_required: 'Choose a reporting manager',
  not_allowed: 'Forbidden',
  invalid_input: 'Invalid input',
  wrong_state: 'This step is not in a state where that can be done',
  review_required: 'Review the flagged issues first',
  blocked: 'Earlier steps are not complete yet',
}

type ActionResult = Result | { ok: true } | { ok: false; error: OffboardingError; message?: string }
type Handler = { roles: string[]; run: (workflowId: string, userId: string, body: Record<string, unknown>) => ActionResult | Promise<ActionResult> }

const HR = ['HR', 'Administrator']

/** Every offboarding action, one route. Role checks here; finer ownership checks (the assigned
 * manager, the exiting employee themself, the IT head) live in lib/offboarding/actions.ts. */
const ACTIONS: Record<string, Handler> = {
  // HR's "Edit exit details" — every field, incl. exit type and confirming the last working day.
  'exit-details': {
    roles: HR,
    run: (w, u, b) =>
      hrEditExitDetails(w, u, {
        exitType: b.exit_type,
        lastWorkingDay: b.last_working_day,
        reason: b.reason,
        noticeStartDate: b.notice_start_date,
        forwardingContact: b.forwarding_contact,
        confirmLastWorkingDay: b.confirm_last_working_day,
      }),
  },
  // "Request details from employee" / "Re-notify employee" (HR) and the employee's answer.
  'request-exit-details': { roles: HR, run: (w, u, b) => requestExitDetails(w, u, { fields: b.fields, message: b.message }) },
  'renotify-exit-details': { roles: HR, run: (w, u) => renotifyExitDetailsRequest(w, u) },
  'submit-exit-details': {
    roles: ['Employee'],
    // Saved before responding; the pre-check re-run happens after the response is sent.
    run: (w, u, b) => submitExitDetails(w, String(b.request_id ?? ''), u, { fields: b.fields }, { defer: (task) => after(task) }),
  },
  notify: { roles: HR, run: (w, u, b) => notifyOffboardingStep(w, String(b.step_key ?? ''), u, { managerUserId: b.manager_user_id }) },
  renotify: { roles: HR, run: (w, u, b) => renotifyOffboardingStep(w, String(b.step_key ?? ''), u) },
  'manager-decision': { roles: ['Manager'], run: (w, u, b) => managerExitDecision(w, u, { decision: b.decision, comment: b.comment }) },
  'hr-precheck': { roles: HR, run: (w, u) => generateHrExitPrecheck(w, u) },
  'hr-approve': { roles: HR, run: (w, u, b) => hrExitApprove(w, u, { acknowledged: b.acknowledged, comment: b.comment }) },
  'hr-send-back': { roles: HR, run: (w, u, b) => hrExitSendBack(w, u, { comment: b.comment }) },
  'handover-confirm': { roles: ['Employee'], run: (w, u, b) => confirmHandover(w, u, { notes: b.notes }) },
  'handover-accept': { roles: ['Manager'], run: (w, u) => acceptHandover(w, u) },
  'asset-mark': { roles: ['IT'], run: (w, u, b) => markAsset(w, u, { itemId: b.item_id, status: b.status, notes: b.notes }) },
  'asset-complete': { roles: ['IT'], run: (w, u) => completeAssetRecovery(w, u) },
  'complete-exit': { roles: HR, run: (w, u) => markExitComplete(w, u) },
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, action } = await params
  const handler = ACTIONS[action]
  if (!handler) return NextResponse.json({ error: 'Unknown action' }, { status: 404 })
  if (!handler.roles.includes(caller.role.name)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  try {
    const result = await handler.run(id, caller.user.id, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? DEFAULT_MESSAGE[result.error], code: result.error }, { status: ERROR_STATUS[result.error] })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    // AI or external-system failure: nothing was half-created (actions do slow work before writing),
    // so the step stays where it was and the UI offers Retry.
    console.error(`[offboarding] ${action} failed for ${id}:`, error)
    return NextResponse.json({ error: 'The automation failed — nothing was changed. Retry in a moment.', code: 'automation_failed' }, { status: 502 })
  }
}

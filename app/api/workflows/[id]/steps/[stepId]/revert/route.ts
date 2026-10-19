import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { revertStep, type RevertError } from '@/lib/workflow-revert'

/** Server-side authority for whether the Revert control exists at all — mirrors
 * NEXT_PUBLIC_ENABLE_STEP_DEV_CONTROLS, which only decides whether the button renders client-side.
 * Off (the default in production) means this route always 403s, regardless of who's calling. */
const REVERT_ENABLED = process.env.ENABLE_STEP_DEV_CONTROLS === 'true'

const ERROR_STATUS: Record<RevertError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_started: 400,
  revert_failed: 500,
}

const ERROR_MESSAGE: Record<RevertError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'Step not found on this workflow',
  not_started: 'This step has not been started yet',
  revert_failed: 'Revert failed — no workflow data was changed',
}

/** HR-only (not Administrator, Manager, or any department login) — see the workflow-timeline UI
 * gating, which hides the button from everyone else too. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  if (!REVERT_ENABLED) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 })
  }

  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'HR') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, stepId } = await params
  // Optional body { reason } — when given it's audit-logged and, for offboarding, sent to everyone
  // affected. Reverting works without one.
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null
  const result = await revertStep(id, stepId, caller.user.id, reason)
  if (!result.ok) {
    // failedAt names the operation that threw (also logged server-side with the full stack).
    const message = result.failedAt ? `${ERROR_MESSAGE[result.error]} (failed at: ${result.failedAt})` : ERROR_MESSAGE[result.error]
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ steps: result.steps, cascadedStepNames: result.cascadedStepNames })
}

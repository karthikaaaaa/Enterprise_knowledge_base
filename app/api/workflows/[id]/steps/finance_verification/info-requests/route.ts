import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import {
  getOpenInfoRequest,
  requestEmployeeInfo,
  type RequestInfoError,
} from '@/lib/employee-info-requests'

const ERROR_STATUS: Record<RequestInfoError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_awaiting_finance: 409,
  nothing_to_request: 409,
  request_already_open: 409,
  invalid_items: 400,
  message_too_long: 400,
}

const ERROR_MESSAGE: Record<RequestInfoError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'Finance Verification is not part of this workflow',
  not_awaiting_finance: 'Finance Verification is not waiting on Finance right now',
  nothing_to_request: 'The latest finance review has nothing the employee needs to provide',
  request_already_open: 'A request is already waiting on the employee',
  invalid_items: 'Choose at least one item to request',
  message_too_long: 'Message is too long (max 1000 characters)',
}

/** The employee's own open request — powers the "Finance needs your details" card on their
 * onboarding page. Only the employee the workflow belongs to; HR/Finance read request status
 * through the finance runs route instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  if (caller.role.name !== 'Employee' || caller.employee?.id !== workflow.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const open = getOpenInfoRequest(id)
  return NextResponse.json({
    request: open ? { id: open.id, items: open.requestedItems, message: open.message, requestedAt: open.requestedAt } : null,
  })
}

/** HR/Administrator: ask the employee for the items Finance flagged as missing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'HR' && caller.role.name !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { items?: unknown; message?: unknown } | null
  const result = requestEmployeeInfo(id, caller.user.id, { items: body?.items, message: body?.message })
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ requestId: result.request.id })
}

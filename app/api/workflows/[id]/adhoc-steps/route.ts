import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { insertAdhocStep, type WorkflowActionError, type AdhocStepInput } from '@/lib/workflow-actions'

const VALID_DEPARTMENTS = new Set(['IT', 'Finance', 'Legal'])

const ERROR_STATUS: Record<WorkflowActionError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_department_fixed: 400,
  already_notified: 409,
  department_role_missing: 400,
  invalid_anchor_step: 400,
  not_completed: 400,
  already_verified: 409,
  step_locked: 409,
  already_submitted: 409,
  precondition_not_met: 400,
  already_granted: 409,
}

const ERROR_MESSAGE: Record<WorkflowActionError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'Step not found on this workflow',
  not_department_fixed: 'This step is not owned by IT, Finance, or Legal',
  already_notified: 'This step has already been notified',
  department_role_missing: 'No role is configured for this department',
  invalid_anchor_step: 'Invalid step to insert after',
  not_completed: "Only a step with status 'completed' can be verified",
  already_verified: 'This step has already been verified',
  step_locked: 'Complete and verify the previous step before starting this one',
  already_submitted: 'This has already been verified and can no longer be edited',
  precondition_not_met: 'Legal Verification must be verified before Knowledge Base access can be granted',
  already_granted: 'Knowledge Base access has already been granted',
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'HR' && caller.role.name !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const departmentName = typeof body?.department_name === 'string' ? body.department_name : ''
  const insertAfterStepId = typeof body?.insert_after_step_id === 'string' ? body.insert_after_step_id : ''
  const subtaskTitles = Array.isArray(body?.subtask_titles)
    ? body.subtask_titles.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    : undefined

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }
  if (!VALID_DEPARTMENTS.has(departmentName)) {
    return NextResponse.json({ error: 'department_name must be IT, Finance, or Legal' }, { status: 400 })
  }
  if (!insertAfterStepId) {
    return NextResponse.json({ error: 'insert_after_step_id is required' }, { status: 400 })
  }

  const input: AdhocStepInput = {
    title,
    description: description || null,
    departmentName: departmentName as AdhocStepInput['departmentName'],
    insertAfterStepId,
    subtaskTitles,
  }

  const result = insertAdhocStep(id, input)

  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ steps: result.steps })
}

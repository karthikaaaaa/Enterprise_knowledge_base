import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { grantKnowledgeBaseAccess, type WorkflowActionError } from '@/lib/workflow-actions'

const ERROR_STATUS: Record<WorkflowActionError, number> = {
  workflow_not_found: 404,
  step_not_found: 404,
  not_department_fixed: 400,
  already_notified: 409,
  department_role_missing: 400,
  invalid_anchor_step: 400,
  not_completed: 400,
  already_verified: 409,
  step_locked: 400,
  already_submitted: 409,
  precondition_not_met: 400,
  already_granted: 409,
}

const ERROR_MESSAGE: Record<WorkflowActionError, string> = {
  workflow_not_found: 'Workflow not found',
  step_not_found: 'This workflow has no Knowledge Base Access step',
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

/** HR/Administrator only. Grants the onboarding employee their default Knowledge Base categories
 * and verifies knowledge_base_access in the same transaction (granting IS the verification — no
 * separate HR Verify click), closing the workflow if only the 'completed' marker step is left. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'HR' && caller.role.name !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const result = grantKnowledgeBaseAccess(id, caller.user.id)
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ steps: result.steps, workflowStatus: result.workflowStatus })
}

import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { uploadEmployeeDocument, REQUIRED_DOCUMENT_TYPES, type WorkflowActionError } from '@/lib/workflow-actions'

// Base64 inflates size ~33%, so this caps the actual file at roughly 8MB — generous for a demo
// upload while still keeping pathologically large payloads out of the sqlite TEXT column.
const MAX_BASE64_LENGTH = 11_000_000

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
  already_submitted: 'Documents have already been verified and can no longer be edited',
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role.name !== 'Employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!caller.employee || caller.employee.id !== workflow.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const documentType = typeof body?.document_type === 'string' ? body.document_type : ''
  const docDef = REQUIRED_DOCUMENT_TYPES.find((d) => d.type === documentType)
  if (!docDef) {
    return NextResponse.json(
      { error: `document_type must be one of: ${REQUIRED_DOCUMENT_TYPES.map((d) => d.type).join(', ')}` },
      { status: 400 },
    )
  }

  const rawFields = body?.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {}
  const fields: Record<string, string> = {}
  for (const fieldDef of docDef.fields) {
    const value = typeof rawFields[fieldDef.key] === 'string' ? (rawFields[fieldDef.key] as string).trim() : ''
    if (!value) {
      return NextResponse.json({ error: `${fieldDef.label} is required for ${docDef.label}` }, { status: 400 })
    }
    fields[fieldDef.key] = value
  }

  const fileName = typeof body?.file_name === 'string' ? body.file_name.trim() : ''
  const mimeType = typeof body?.file_mime_type === 'string' ? body.file_mime_type.trim() : ''
  // The client sends the raw base64 payload (no "data:...;base64," prefix), but strip one off
  // defensively in case a caller includes it.
  const rawData = typeof body?.file_data === 'string' ? body.file_data : ''
  const dataBase64 = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData

  if (!fileName || !mimeType || !dataBase64) {
    return NextResponse.json({ error: 'A file is required for this document' }, { status: 400 })
  }
  if (dataBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'File is too large (max ~8MB)' }, { status: 400 })
  }

  const result = uploadEmployeeDocument(id, caller.user.id, documentType, fields, { fileName, mimeType, dataBase64 })
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }

  return NextResponse.json({ step: result.step, uploaded_types: result.uploadedTypes })
}

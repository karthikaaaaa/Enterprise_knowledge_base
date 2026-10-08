import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { getAgreementToSign, signAgreement, type SignAgreementError } from '@/lib/legal-records'

const ERROR_STATUS: Record<SignAgreementError, number> = {
  workflow_not_found: 404,
  forbidden: 403,
  not_found: 404,
  already_signed: 409,
  consent_required: 400,
  name_mismatch: 400,
}

const ERROR_MESSAGE: Record<SignAgreementError, string> = {
  workflow_not_found: 'Workflow not found',
  forbidden: 'Forbidden',
  not_found: 'Agreement not found',
  already_signed: 'This agreement has already been signed',
  consent_required: 'Confirm that you agree to the terms',
  name_mismatch: 'Type your full legal name exactly as it appears in your employee details',
}

/** The employee's own issued, unsigned agreement — powers the "Sign your agreement" card. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  if (caller.role.name !== 'Employee' || caller.employee?.id !== workflow.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ agreement: getAgreementToSign(id) })
}

/** The employee signs by typing their legal name and confirming. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { agreement_id?: unknown; signed_name?: unknown; consent?: unknown } | null
  const result = await signAgreement(
    id,
    typeof body?.agreement_id === 'string' ? body.agreement_id : '',
    caller.user.id,
    { signedName: body?.signed_name, consent: body?.consent },
    { defer: (task) => after(task) },
  )
  if (!result.ok) return NextResponse.json({ error: ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  return NextResponse.json({ ok: true })
}

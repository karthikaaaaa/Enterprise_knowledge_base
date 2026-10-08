import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { getAgreementDraft, issueAgreement, type CreateLegalRecordError } from '@/lib/legal-records'

const ERROR_STATUS: Record<CreateLegalRecordError, number> = {
  workflow_not_found: 404,
  not_awaiting_legal: 409,
  already_created: 409,
  not_ready: 409,
}

const ERROR_MESSAGE: Record<CreateLegalRecordError, string> = {
  workflow_not_found: 'Workflow not found',
  not_awaiting_legal: 'Legal Verification is not waiting on Legal right now',
  already_created: 'A confidentiality agreement has already been issued',
  not_ready: 'The agreement cannot be issued yet',
}

/** The drafted agreement (full text) and the issued one, if any. Legal and HR/Administrator. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Legal', 'HR', 'Administrator'].includes(caller.role.name)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!getWorkflow(id)) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  const { draft, record } = getAgreementDraft(id)
  return NextResponse.json({
    draft,
    record: record
      ? {
          id: record.id,
          title: record.title,
          version: record.version,
          body: record.body,
          createdAt: record.issuedAt,
          signedName: record.signedName,
          signedAt: record.signedAt,
        }
      : null,
  })
}

/** Legal only: issue the drafted agreement to the employee for signature. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Legal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const result = await issueAgreement(id, caller.user.id, { defer: (task) => after(task) })
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ recordId: result.record.id })
}

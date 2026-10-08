import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { createPayrollEntry, getPayrollDraft, type CreatePayrollError } from '@/lib/payroll'

const ERROR_STATUS: Record<CreatePayrollError, number> = {
  workflow_not_found: 404,
  not_awaiting_finance: 409,
  already_created: 409,
  not_ready: 409,
  invalid_input: 400,
}

const ERROR_MESSAGE: Record<CreatePayrollError, string> = {
  workflow_not_found: 'Workflow not found',
  not_awaiting_finance: 'Finance Verification is not waiting on Finance right now',
  already_created: 'A payroll entry already exists for this employee',
  not_ready: 'The payroll entry cannot be created yet',
  invalid_input: 'Some payroll details are invalid',
}

/** The drafted payroll entry (and the created one, if any). Finance and HR/Administrator. Bank and
 * tax appear only as masked references; compensation only on a created record. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Finance', 'HR', 'Administrator'].includes(caller.role.name)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  if (!getWorkflow(id)) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  const { draft, record } = getPayrollDraft(id)
  return NextResponse.json({
    draft,
    record: record
      ? {
          id: record.id,
          payFrequency: record.payFrequency,
          annualSalary: record.annualSalary,
          currency: record.currency,
          createdAt: record.createdAt,
        }
      : null,
  })
}

/** Finance only: create the payroll entry from the draft, adding compensation. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role.name !== 'Finance') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await createPayrollEntry(
    id,
    caller.user.id,
    { annualSalary: body?.annual_salary, currency: body?.currency, payFrequency: body?.pay_frequency },
    // The entry is saved before responding; the AI review re-run happens after the response.
    { defer: (task) => after(task) },
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ recordId: result.record.id })
}

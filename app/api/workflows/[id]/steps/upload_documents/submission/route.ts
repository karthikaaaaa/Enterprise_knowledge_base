import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow, listEmployeeDocumentsByWorkflow } from '@/lib/workflow-store'

/** What's been uploaded so far for step 2 — powers the employee's upload checklist and HR's
 * read-only review of it. Returns an empty list rather than 404 before anything is uploaded,
 * since "0 of 3 uploaded" is itself a valid, expected state (unlike step 1's submission). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const roleName = caller.role.name
  const authorized =
    roleName === 'HR' ||
    roleName === 'Administrator' ||
    (roleName === 'Employee' && !!caller.employee && caller.employee.id === workflow.employeeId)

  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ documents: listEmployeeDocumentsByWorkflow(id) })
}

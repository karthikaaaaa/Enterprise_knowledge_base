import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getWorkflow } from '@/lib/workflow-store'
import { resetLastVerifiedStep } from '@/lib/workflow-actions'

/** Testing convenience only — never available in production, regardless of who's calling or how.
 * Lets the employee undo just the single furthest-along verified step on their own workflow, so
 * they can redo it with different data without disturbing anything already done before it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 })
  }

  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const workflow = getWorkflow(id)
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!caller.employee || caller.employee.id !== workflow.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = resetLastVerifiedStep(id)
  if (!result.ok) {
    const status = result.error === 'nothing_to_reset' ? 400 : 404
    const message = result.error === 'nothing_to_reset' ? 'No completed step to reset yet' : 'Workflow not found'
    return NextResponse.json({ error: message }, { status })
  }

  return NextResponse.json({ step: result.step })
}

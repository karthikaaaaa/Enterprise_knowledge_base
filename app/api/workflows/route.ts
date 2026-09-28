import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { listWorkflowSummaries } from '@/lib/workflow-view'

export async function GET(request: Request) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  switch (caller.role.name) {
    case 'HR':
    case 'Administrator':
      return NextResponse.json({ workflows: listWorkflowSummaries() })

    case 'Manager': {
      if (!caller.user.departmentId) return NextResponse.json({ workflows: [] })
      return NextResponse.json({ workflows: listWorkflowSummaries({ departmentId: caller.user.departmentId }) })
    }

    case 'Employee': {
      if (!caller.employee) return NextResponse.json({ workflows: [] })
      return NextResponse.json({ workflows: listWorkflowSummaries({ employeeId: caller.employee.id }) })
    }

    default:
      // IT / Finance / Legal don't get this combined view — their department view lands in a later step.
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

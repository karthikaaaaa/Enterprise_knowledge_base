import { FINANCE_TASK_IDS } from '@/lib/finance-verification-log'
import { describeInfoRequest, getLatestInfoRequest } from '@/lib/employee-info-requests'
import { handleStructuredRunsGet, handleStructuredRunsPost, type StructuredRunsConfig } from '@/lib/structured-runs-route'

const CONFIG: StructuredRunsConfig = {
  stepKey: 'finance_verification',
  taskIds: FINANCE_TASK_IDS,
  ownerRole: 'Finance',
  // The latest "request info from employee" (open or answered), so HR and Finance can both see where
  // a review stands. Never includes the submitted values.
  extra: (workflowId) => {
    const latest = getLatestInfoRequest(workflowId)
    return { infoRequest: latest ? describeInfoRequest(latest) : null }
  },
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsGet(request, id, CONFIG)
}

/** "Re-run AI": Finance (the owning department) or HR/Administrator. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsPost(request, id, CONFIG)
}

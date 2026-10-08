import { LEGAL_TASK_IDS } from '@/lib/legal-verification-log'
import { getAgreementToSign } from '@/lib/legal-records'
import { handleStructuredRunsGet, handleStructuredRunsPost, type StructuredRunsConfig } from '@/lib/structured-runs-route'

const CONFIG: StructuredRunsConfig = {
  stepKey: 'legal_verification',
  taskIds: LEGAL_TASK_IDS,
  ownerRole: 'Legal',
  // Whether an issued agreement is still waiting on the employee — shown to HR and Legal.
  extra: (workflowId) => {
    const pending = getAgreementToSign(workflowId)
    return { pendingSignature: pending ? { title: pending.title, issuedAt: pending.issuedAt } : null }
  },
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsGet(request, id, CONFIG)
}

/** "Re-run AI": Legal (the owning department) or HR/Administrator. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsPost(request, id, CONFIG)
}

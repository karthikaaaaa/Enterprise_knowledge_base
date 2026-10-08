import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import { handleStructuredRunsGet, handleStructuredRunsPost, type StructuredRunsConfig } from '@/lib/structured-runs-route'

/** Offboarding finance_settlement's structured AI log — Finance sees the full log, HR the summary (or full with ?view=full). */
const CONFIG: StructuredRunsConfig = { stepKey: 'finance_settlement', taskIds: OFFBOARDING_TASK_IDS.finance_settlement, ownerRole: 'Finance' }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsGet(request, id, CONFIG)
}

/** "Re-run AI" — re-applies the step's actions idempotently, then rebuilds the log. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsPost(request, id, CONFIG)
}

import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import { handleStructuredRunsGet, handleStructuredRunsPost, type StructuredRunsConfig } from '@/lib/structured-runs-route'

/** Offboarding legal_clearance's structured AI log — Legal sees the full log, HR the summary (or full with ?view=full). */
const CONFIG: StructuredRunsConfig = { stepKey: 'legal_clearance', taskIds: OFFBOARDING_TASK_IDS.legal_clearance, ownerRole: 'Legal' }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsGet(request, id, CONFIG)
}

/** "Re-run AI" — re-applies the step's actions idempotently, then rebuilds the log. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsPost(request, id, CONFIG)
}

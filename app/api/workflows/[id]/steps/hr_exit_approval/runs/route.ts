import { OFFBOARDING_TASK_IDS } from '@/lib/offboarding/reviews'
import { handleStructuredRunsGet, handleStructuredRunsPost, type StructuredRunsConfig } from '@/lib/structured-runs-route'

/** Offboarding hr_exit_approval's structured AI log — HR sees the full log, HR the summary (or full with ?view=full). */
const CONFIG: StructuredRunsConfig = {
  stepKey: 'hr_exit_approval',
  taskIds: OFFBOARDING_TASK_IDS.hr_exit_approval,
  ownerRole: 'HR',
  // Reverting HR Exit Approval starts a new round; earlier runs stay visible in the history.
  historyScope: 'workflow',
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsGet(request, id, CONFIG)
}

/** "Re-run AI" — re-applies the step's actions idempotently, then rebuilds the log. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleStructuredRunsPost(request, id, CONFIG)
}

import { getStepSummaryResponse } from '@/lib/step-summary-route'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return getStepSummaryResponse(request, id, 'legal_verification')
}

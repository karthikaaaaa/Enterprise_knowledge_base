import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getOffboardingState } from '@/lib/offboarding/view'

/** Offboarding-specific state for this workflow, scoped to what the caller may see. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const state = getOffboardingState(id, caller)
  if (!state) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(state)
}

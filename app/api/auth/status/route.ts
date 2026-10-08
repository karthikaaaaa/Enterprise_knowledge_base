import { NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/workflow-store'
import { offboardingStatusForUser } from '@/lib/offboarding/access'

/** Login-time account check: the demo login itself is client-side, so this is where a deactivated
 * account (an employee whose exit is complete) is refused before a session starts — and how the
 * shell learns an employee is mid-offboarding (restricted navigation). Every API independently
 * rejects inactive users via getCaller, so this is the UX half, not the only guard. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const user = email ? getUserByEmail(email) : null
  if (!user) return NextResponse.json({ exists: false, active: false, offboarding: null })
  return NextResponse.json({ exists: true, active: user.isActive, offboarding: offboardingStatusForUser(user.id) })
}

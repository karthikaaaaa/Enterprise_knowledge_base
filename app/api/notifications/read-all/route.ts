import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { markAllNotificationsRead } from '@/lib/workflow-store'

export async function POST(request: Request) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  markAllNotificationsRead(caller.role.id, caller.user.id)
  return NextResponse.json({ ok: true })
}

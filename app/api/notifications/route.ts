import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { listNotificationsForRole } from '@/lib/notification-view'

export async function GET(request: Request) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ notifications: listNotificationsForRole(caller.role.id, caller.user.id) })
}

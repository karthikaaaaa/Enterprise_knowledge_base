import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { countUnreadNotifications } from '@/lib/workflow-store'

export async function GET(request: Request) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ count: countUnreadNotifications(caller.role.id) })
}

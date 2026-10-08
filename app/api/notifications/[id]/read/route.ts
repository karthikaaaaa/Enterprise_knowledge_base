import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { getNotificationById, markNotificationRead } from '@/lib/workflow-store'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = getCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const notification = getNotificationById(id)
  if (!notification) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  }
  if (notification.roleId !== caller.role.id || (notification.recipientUserId && notification.recipientUserId !== caller.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  markNotificationRead(id)
  return NextResponse.json({ notification: { ...notification, isRead: true } })
}

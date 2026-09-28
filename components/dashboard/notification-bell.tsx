'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPatch, authedPost } from '@/lib/api-client'
import { formatRelativeTime } from '@/lib/workflow-format'
import type { NotificationItem } from '@/lib/notification-view'

const POLL_INTERVAL_MS = 12000
const DEPARTMENT_ROLES = new Set(['it', 'finance', 'legal'])

export function NotificationBell() {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: countData, mutate: mutateCount } = useSWR<{ count: number }>(
    user ? '/api/notifications/unread-count' : null,
    authedFetcher(user?.email),
    { refreshInterval: POLL_INTERVAL_MS },
  )
  const { data: listData, mutate: mutateList } = useSWR<{ notifications: NotificationItem[] }>(
    open && user ? '/api/notifications' : null,
    authedFetcher(user?.email),
  )

  const unreadCount = countData?.count ?? 0
  const notifications = listData?.notifications ?? []

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  async function handleMarkAllRead() {
    await authedPost('/api/notifications/read-all', user?.email)
    await Promise.all([
      mutateList(
        (current) => (current ? { notifications: current.notifications.map((n) => ({ ...n, isRead: true })) } : current),
        { revalidate: false },
      ),
      mutateCount({ count: 0 }, { revalidate: false }),
    ])
  }

  async function handleNotificationClick(notification: NotificationItem) {
    if (!notification.isRead) {
      await authedPatch(`/api/notifications/${notification.id}/read`, user?.email)
      await Promise.all([
        mutateList(
          (current) =>
            current
              ? { notifications: current.notifications.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)) }
              : current,
          { revalidate: false },
        ),
        mutateCount((current) => (current ? { count: Math.max(0, current.count - 1) } : current), { revalidate: false }),
      ])
    }

    setOpen(false)

    if (user && DEPARTMENT_ROLES.has(user.role)) {
      router.push('/tasks')
    } else if (notification.workflowId && notification.workflowType) {
      router.push(`/automation/${notification.workflowType}/${notification.workflowId}`)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:text-foreground hover:shadow-lift"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow px-1 text-[10px] font-semibold text-yellow-ink ring-2 ring-card">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-30 w-80 rounded-2xl border border-border bg-card p-2 shadow-lift">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-semibold text-foreground">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-blue-ink hover:underline"
              >
                Mark all as read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No notifications yet.</p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary',
                    !notification.isRead && 'bg-accent/40',
                  )}
                >
                  <span
                    className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', notification.isRead ? 'bg-transparent' : 'bg-primary')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-xs leading-relaxed',
                        notification.isRead ? 'text-muted-foreground' : 'font-semibold text-foreground',
                      )}
                    >
                      {notification.message}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

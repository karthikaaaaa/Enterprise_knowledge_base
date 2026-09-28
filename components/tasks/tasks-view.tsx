'use client'

import useSWR from 'swr'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher } from '@/lib/api-client'
import type { TaskItem } from '@/lib/task-view'
import { TaskCard } from '@/components/tasks/task-card'

export function TasksView() {
  const { user } = useAuth()
  const { data, error, isLoading, mutate } = useSWR<{ tasks: TaskItem[] }>(
    user ? '/api/tasks' : null,
    authedFetcher(user?.email),
  )

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tasks…</p>
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load tasks. Please try again.</p>
  }

  const tasks = data?.tasks ?? []
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks assigned to your department right now.</p>
  }

  const groups: { employee: TaskItem['employee']; tasks: TaskItem[] }[] = []
  const groupByEmployee = new Map<string, { employee: TaskItem['employee']; tasks: TaskItem[] }>()
  for (const task of tasks) {
    let group = groupByEmployee.get(task.employee.id)
    if (!group) {
      group = { employee: task.employee, tasks: [] }
      groupByEmployee.set(task.employee.id, group)
      groups.push(group)
    }
    group.tasks.push(task)
  }

  function patchTask(approvalId: string, patch: Partial<TaskItem>) {
    mutate(
      (current) =>
        current
          ? { tasks: current.tasks.map((t) => (t.approvalId === approvalId ? { ...t, ...patch } : t)) }
          : current,
      { revalidate: false },
    )
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.employee.id} className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-blue-ink">
              {group.employee.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{group.employee.name}</p>
              <p className="text-xs text-muted-foreground">{group.employee.role}</p>
            </div>
          </div>
          <div className="space-y-3">
            {group.tasks.map((task) => (
              <TaskCard key={task.approvalId} task={task} onUpdated={(patch) => patchTask(task.approvalId, patch)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Check, CircleCheck, UserPlus, Workflow, FileCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type Task = {
  id: number
  label: string
  category: string
  icon: typeof UserPlus
  tone: 'blue' | 'yellow'
  done: boolean
}

const initial: Task[] = [
  {
    id: 1,
    label: 'Approve leave request — J. Rivera',
    category: 'Pending Approval',
    icon: FileCheck,
    tone: 'yellow',
    done: false,
  },
  {
    id: 2,
    label: 'Complete onboarding for new hire',
    category: 'Onboarding',
    icon: UserPlus,
    tone: 'blue',
    done: false,
  },
  {
    id: 3,
    label: 'Review offboarding checklist — T. Adeyemi',
    category: 'Workflow',
    icon: Workflow,
    tone: 'blue',
    done: false,
  },
  {
    id: 4,
    label: 'Sign updated NDA document',
    category: 'Pending Approval',
    icon: FileCheck,
    tone: 'yellow',
    done: true,
  },
]

export function MyTasks() {
  const [tasks, setTasks] = useState<Task[]>(initial)
  const completed = tasks.filter((t) => t.done).length

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">My Tasks</h2>
          <p className="text-xs text-muted-foreground">
            {completed} of {tasks.length} completed
          </p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-accent text-blue-ink">
          <CircleCheck className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${(completed / tasks.length) * 100}%` }}
        />
      </div>

      <ul className="mt-4 flex flex-1 flex-col gap-2">
        {tasks.map((task) => {
          const Icon = task.icon
          return (
            <li key={task.id}>
              <button
                onClick={() =>
                  setTasks((prev) =>
                    prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)),
                  )
                }
                className="group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors duration-200 hover:bg-secondary"
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200',
                    task.done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-transparent group-hover:border-ring',
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      task.done
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground',
                    )}
                  >
                    {task.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {task.category}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                    task.tone === 'blue'
                      ? 'bg-accent text-blue-ink'
                      : 'bg-yellow-soft text-yellow-ink',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

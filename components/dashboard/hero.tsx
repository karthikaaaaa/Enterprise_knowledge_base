'use client'

import { Search, Command, FileText, Users, Sparkles } from 'lucide-react'

const suggestions = [
  { label: 'Remote work policy', icon: FileText },
  { label: 'Onboarding checklist', icon: Users },
  { label: 'Q3 engineering roadmap', icon: Sparkles },
]

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-soft md:p-9">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue opacity-70 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-yellow-soft opacity-80 blur-2xl" />

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Good morning, Amara
        </span>

        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Enterprise Knowledge Base
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
          Search every document, policy, and piece of company knowledge in one
          place. Ask a question in plain language and let AI find the answer.
        </p>

        <div className="mt-6 flex max-w-2xl items-center gap-2 rounded-2xl border border-border bg-background p-2 shadow-soft transition-shadow duration-200 focus-within:shadow-lift focus-within:ring-2 focus-within:ring-ring/60">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Search className="h-5 w-5" />
          </div>
          <input
            type="search"
            placeholder="Ask anything or search documents, people, workflows..."
            className="h-10 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground sm:flex">
            <Command className="h-3 w-3" /> K
          </kbd>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Try:</span>
          {suggestions.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-soft"
              >
                <Icon className="h-3.5 w-3.5 text-blue-ink" />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

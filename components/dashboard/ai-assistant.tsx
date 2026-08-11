'use client'

import { Sparkles, ArrowUp, FileText } from 'lucide-react'

const prompts = [
  'Summarize the new remote work policy',
  'What are the onboarding steps for engineers?',
  'Find our latest brand guidelines',
]

export function AiAssistant() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-3 border-b border-border bg-blue-soft px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">AI Assistant</h2>
          <p className="text-xs text-muted-foreground">Powered by your knowledge base</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Online
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        <div className="flex justify-end">
          <p className="max-w-[80%] rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 text-sm text-accent-foreground">
            What&apos;s our policy on working from abroad?
          </p>
        </div>

        <div className="flex gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-yellow text-yellow-ink">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-secondary px-4 py-3 text-sm leading-relaxed text-foreground">
            Employees can work abroad for up to 30 days per year with manager
            approval. Here&apos;s the source document:
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-blue-ink">
              <FileText className="h-4 w-4" />
              Remote Work Policy 2026.pdf
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-6 pb-5 pt-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {prompts.map((p) => (
            <button
              key={p}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:text-foreground hover:shadow-soft"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-background p-2 transition-shadow focus-within:shadow-soft focus-within:ring-2 focus-within:ring-ring/60">
          <input
            type="text"
            placeholder="Ask anything about your company..."
            className="h-9 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5">
            <ArrowUp className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import {
  Plus,
  Search,
  Sparkles,
  FileText,
  MessageSquare,
  ArrowUp,
  Copy,
  ThumbsUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Source = { name: string; page: string }
type Message = {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

const conversations = [
  { id: 1, title: 'How many vacation days do I get?', time: 'Just now', active: true },
  { id: 2, title: 'Remote work eligibility', time: '2h ago', active: false },
  { id: 3, title: 'Expense reimbursement limits', time: 'Yesterday', active: false },
  { id: 4, title: 'MFA setup instructions', time: 'Mon', active: false },
  { id: 5, title: 'Parental leave policy', time: 'Last week', active: false },
]

const suggestions = [
  'What is our remote work policy?',
  'How do I submit an expense report?',
  'Summarize the employee handbook',
  'What are the company holidays this year?',
]

const initialMessages: Message[] = [
  {
    role: 'user',
    content: 'How many vacation days do I get and how do I request time off?',
  },
  {
    role: 'assistant',
    content:
      'You accrue 1.75 days of paid annual leave per month, which works out to 21 days per year. You can carry over up to 5 unused days into the next year. To request time off, submit your dates through the HR portal at least two weeks in advance for planned leave. Your manager will be notified automatically for approval.',
    sources: [
      { name: 'Employee Handbook 2025.pdf', page: 'p. 18' },
      { name: 'Leave & Time-Off Policy.docx', page: 'p. 3' },
      { name: 'HR Policies.pdf', page: 'p. 7' },
    ],
  },
]

export function AiChatView() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      {
        role: 'assistant',
        content:
          'Based on the indexed company documents, here is what I found. This is a demo response generated from your knowledge base to illustrate how answers appear with their source citations below.',
        sources: [
          { name: 'Employee Handbook 2025.pdf', page: 'p. 12' },
          { name: 'Remote Work Policy.pdf', page: 'p. 4' },
        ],
      },
    ])
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-6">
      {/* History */}
      <aside className="hidden w-72 shrink-0 flex-col rounded-3xl border border-border bg-card p-4 shadow-soft lg:flex">
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
          <Plus className="h-4 w-4" />
          New Chat
        </button>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search chats..."
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/60"
          />
        </div>
        <p className="mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent
        </p>
        <div className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors',
                c.active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-[11px] text-muted-foreground">{c.time}</p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex min-w-0 flex-1 flex-col rounded-3xl border border-border bg-card shadow-soft">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-yellow text-yellow-ink">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Knowledge Assistant</p>
            <p className="text-xs text-muted-foreground">Answers grounded in your documents</p>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-3xl rounded-br-lg bg-primary px-5 py-3 text-sm leading-relaxed text-primary-foreground shadow-soft">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-yellow text-yellow-ink">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="max-w-[85%]">
                  <div className="rounded-3xl rounded-tl-lg bg-secondary px-5 py-4 text-sm leading-relaxed text-foreground">
                    {m.content}
                    {m.sources ? (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="text-xs font-semibold text-muted-foreground">Sources</p>
                        <div className="mt-2 flex flex-col gap-2">
                          {m.sources.map((s) => (
                            <div
                              key={s.name}
                              className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-soft"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-blue-ink" />
                              <span className="flex-1 truncate text-xs font-medium text-foreground">
                                {s.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground">{s.page}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>

        {messages.length <= 2 ? (
          <div className="flex flex-wrap gap-2 px-6 pb-3">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-soft"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="border-t border-border p-4">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-soft transition-shadow duration-200 focus-within:shadow-lift focus-within:ring-2 focus-within:ring-ring/60">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask a question about your company knowledge..."
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => send(input)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-40"
              disabled={!input.trim()}
            >
              <ArrowUp className="h-5 w-5" />
              <span className="sr-only">Send</span>
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Answers are generated from your indexed documents and may need verification.
          </p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  Search,
  Sparkles,
  FileText,
  ArrowUp,
  Copy,
  ThumbsUp,
  Check,
  Trash2,
  Loader2,
} from 'lucide-react'
import { Markdown } from '@/components/chat/markdown'

type Source = { id: string; name: string }
type Message = {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}
type Conversation = {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'ekb.ai-chat.conversations'

const suggestions = [
  'What is our remote work policy?',
  'How do I submit an expense report?',
  'Summarize the employee handbook',
  'What are the company holidays this year?',
]

function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function AiChatView() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load saved conversations once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setConversations(parsed as Conversation[])
      }
    } catch {
      // ignore unavailable / corrupt storage
    }
    setHydrated(true)
  }, [])

  // Persist on every change, but only after the initial load.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
    } catch {
      // ignore quota / unavailable storage
    }
  }, [conversations, hydrated])

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null
  const messages = activeConversation?.messages ?? []

  // Keep the transcript scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, loading])

  const query = search.trim().toLowerCase()
  const visibleConversations = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) =>
      query
        ? c.title.toLowerCase().includes(query) ||
          c.messages.some((m) => m.content.toLowerCase().includes(query))
        : true,
    )

  function newChat() {
    setActiveId(null)
    setInput('')
    setError('')
  }

  function deleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setError('')
    }
  }

  async function copyAnswer(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMessage: Message = { role: 'user', content: trimmed }

    // Each question is stored: it either continues the open conversation or
    // starts (and saves) a new one.
    let conversationId = activeId
    if (conversationId && conversations.some((c) => c.id === conversationId)) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, userMessage], updatedAt: Date.now() }
            : c,
        ),
      )
    } else {
      conversationId = genId()
      const conversation: Conversation = {
        id: conversationId,
        title: makeTitle(trimmed),
        messages: [userMessage],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setConversations((prev) => [conversation, ...prev])
    }

    setActiveId(conversationId)
    setInput('')
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Failed to get an answer')
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, assistantMessage], updatedAt: Date.now() }
            : c,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get an answer')
    } finally {
      setLoading(false)
    }
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
        <button
          onClick={newChat}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/60"
          />
        </div>
        <p className="mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent
        </p>
        <div className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto">
          {visibleConversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {conversations.length === 0 ? 'No conversations yet.' : 'No matches.'}
            </p>
          ) : (
            visibleConversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-xl px-1 transition-colors ${
                  c.id === activeId ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <button
                  onClick={() => {
                    setActiveId(c.id)
                    setError('')
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-2 text-left"
                >
                  <span className="w-full truncate text-sm font-medium text-foreground">
                    {c.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeTime(c.updatedAt)}
                  </span>
                </button>
                <button
                  onClick={() => deleteConversation(c.id)}
                  aria-label="Delete conversation"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-card hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
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

        <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
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
                    <Markdown content={m.content} />
                    {m.sources && m.sources.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="text-xs font-semibold text-muted-foreground">Sources</p>
                        <div className="mt-2 flex flex-col gap-2">
                          {m.sources.map((s) => (
                            <Link
                              key={s.id}
                              href={`/knowledge-base/${s.id}`}
                              className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-soft transition-colors hover:bg-accent"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-blue-ink" />
                              <span className="flex-1 truncate text-xs font-medium text-foreground">
                                {s.name}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      onClick={() => copyAnswer(m.content, i)}
                      aria-label="Copy answer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {copiedIndex === i ? (
                        <Check className="h-3.5 w-3.5 text-blue-ink" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      aria-label="Good answer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ),
          )}
          {loading ? (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-yellow text-yellow-ink">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 rounded-3xl rounded-tl-lg bg-secondary px-5 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching your documents...
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {messages.length === 0 ? (
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
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
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

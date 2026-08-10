'use client'

import { useState } from 'react'
import {
  User,
  Palette,
  Bell,
  Shield,
  Info,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const sections = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'about', label: 'About', icon: Info },
] as const

type SectionId = (typeof sections)[number]['id']

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <button
      onClick={() => setOn((v) => !v)}
      role="switch"
      aria-checked={on}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        on ? 'bg-primary' : 'bg-secondary',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-soft transition-transform duration-200',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function Row({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">{children}</div>
  )
}

export function SettingsView() {
  const [active, setActive] = useState<SectionId>('profile')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light')
  const [accent, setAccent] = useState<'blue' | 'yellow'>('blue')

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col">
        {sections.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200',
                active === s.id
                  ? 'bg-accent text-accent-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </button>
          )
        })}
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        {active === 'profile' ? (
          <Card>
            <h2 className="text-base font-semibold text-foreground">Profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update your personal information.
            </p>
            <div className="mt-5 flex items-center gap-4">
              <img
                src="/avatars/user.png"
                alt="Amara Okafor"
                className="h-16 w-16 rounded-2xl object-cover shadow-soft"
              />
              <button className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
                Change photo
              </button>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" value="Amara Okafor" />
              <Field label="Job title" value="Knowledge Admin" />
              <Field label="Email" value="amara.okafor@company.com" />
              <Field label="Department" value="Operations" />
            </div>
            <div className="mt-6 flex justify-end">
              <button className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                Save changes
              </button>
            </div>
          </Card>
        ) : null}

        {active === 'appearance' ? (
          <Card>
            <h2 className="text-base font-semibold text-foreground">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Personalize how KnowledgeOS looks for you.
            </p>
            <p className="mt-6 text-sm font-medium text-foreground">Theme</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    'rounded-2xl border p-3 text-left transition-all duration-200',
                    theme === t
                      ? 'border-primary bg-accent/50 shadow-soft'
                      : 'border-border bg-card hover:-translate-y-0.5 hover:shadow-soft',
                  )}
                >
                  <div
                    className={cn(
                      'mb-2 h-12 w-full rounded-xl border border-border',
                      t === 'light' && 'bg-[#f4f8fc]',
                      t === 'dark' && 'bg-[#16233a]',
                      t === 'system' && 'bg-gradient-to-r from-[#f4f8fc] to-[#16233a]',
                    )}
                  />
                  <span className="text-xs font-semibold capitalize text-foreground">{t}</span>
                </button>
              ))}
            </div>
            <p className="mt-6 text-sm font-medium text-foreground">Accent color</p>
            <div className="mt-3 flex gap-3">
              {(['blue', 'yellow'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setAccent(c)}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-2xl shadow-soft transition-transform duration-200 hover:scale-105',
                    c === 'blue' ? 'bg-primary' : 'bg-yellow',
                  )}
                  aria-label={`${c} accent`}
                >
                  {accent === c ? (
                    <Check className={cn('h-4 w-4', c === 'blue' ? 'text-white' : 'text-yellow-ink')} />
                  ) : null}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {active === 'notifications' ? (
          <Card>
            <h2 className="text-base font-semibold text-foreground">Notifications</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose what you want to be notified about.
            </p>
            <div className="mt-4 divide-y divide-border">
              <Row title="New documents" desc="When a document is added to your departments">
                <Toggle defaultOn />
              </Row>
              <Row title="Workflow updates" desc="Onboarding and offboarding status changes">
                <Toggle defaultOn />
              </Row>
              <Row title="AI answers" desc="When the assistant finishes a long query">
                <Toggle />
              </Row>
              <Row title="Weekly digest" desc="A summary of activity every Monday">
                <Toggle defaultOn />
              </Row>
            </div>
          </Card>
        ) : null}

        {active === 'security' ? (
          <Card>
            <h2 className="text-base font-semibold text-foreground">Security</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your account security settings.
            </p>
            <div className="mt-4 divide-y divide-border">
              <Row title="Two-factor authentication" desc="Add an extra layer of security">
                <Toggle defaultOn />
              </Row>
              <Row title="Login alerts" desc="Get notified of new sign-ins">
                <Toggle defaultOn />
              </Row>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
                Change password
              </button>
              <button className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-destructive transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
                Sign out all devices
              </button>
            </div>
          </Card>
        ) : null}

        {active === 'about' ? (
          <Card>
            <h2 className="text-base font-semibold text-foreground">About</h2>
            <p className="mt-1 text-sm text-muted-foreground">Application information.</p>
            <div className="mt-4 divide-y divide-border">
              <Row title="Version" desc="Current release of KnowledgeOS">
                <span className="text-sm font-semibold text-foreground">v2.4.1</span>
              </Row>
              <Row title="Documents indexed" desc="Across all departments">
                <span className="text-sm font-semibold text-foreground">1,284</span>
              </Row>
              <Row title="Support" desc="Reach our team any time">
                <span className="text-sm font-semibold text-blue-ink">help@knowledgeos.com</span>
              </Row>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-foreground">{label}</span>
      <input
        defaultValue={value}
        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/60"
      />
    </label>
  )
}

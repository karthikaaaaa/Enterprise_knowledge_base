'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Loader2,
  Circle,
  ChevronDown,
  Eye,
  User,
  Briefcase,
  Calendar,
  X,
  Bell,
  Plus,
  ShieldCheck,
  Pencil,
  Sparkles,
  Upload,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatWorkflowDate } from '@/lib/workflow-format'

export type StepStatus = 'completed' | 'in-progress' | 'pending'

export type WorkflowStep = {
  id: string
  /** Raw step name (e.g. "employee_details") — lets the timeline special-case a specific card
   * without hardcoding the humanized title. */
  stepName: string
  title: string
  description: string
  status: StepStatus
  meta: string
  details: string
  /** e.g. "Custom" for an HR-inserted ad-hoc step, so it's visually distinct from template steps. */
  tag?: string
  /** Clarifying text shown under the title while a dept-owned step is done but not yet HR-verified. */
  subLabel?: string
  /** IT / Finance / Legal / HR / Manager — drives the "Notify <department>" button label by
   * default (overridden by notifyLabel when set). */
  departmentName: string
  /** Overrides the word shown after "Notify " on this step's button, when the button should read
   * differently than the step's actual owning role (asset_allocation and it_verification both read
   * "Notify IT" even though they're routed to the Manager role/Diego Ramirez). Doesn't affect who
   * actually gets notified — that's still driven by departmentName server-side. */
  notifyLabel?: string
  /** True only for a pending IT/Finance/Legal-owned step with no approval row yet. */
  canNotify: boolean
  /** True only once the step has actually reached 'completed' (department sign-off, or an
   * employee/HR submission) and hasn't been verified yet — never while still 'pending'. */
  canVerify: boolean
  /** True for the employee's own employee_details card any time it isn't verified yet — covers
   * both the first fill-in and editing/resubmitting a completed-but-unverified submission. */
  canFillDetails?: boolean
  /** Known values to prefill the Fill/Edit Details form with; anything else starts blank. Once a
   * submission exists, this carries the full submitted record so editing starts from what's there. */
  prefill?: {
    fullName?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    roleTitle?: string | null
    department?: string | null
    startDate?: string | null
  }
  /** Once available, the real submitted fields — shown instead of the plain description/details text. */
  submittedDetails?: Record<string, string> | null
  /** The HR note left when this step was verified, if any — shown alongside whatever else the
   * card renders (submittedDetails, documentChecklist, aiVerification, or plain details text). */
  verificationComment?: string | null
  /** upload_documents only: the employee's document checklist. */
  documentChecklist?: DocumentChecklistItem[]
  /** True for the employee's own upload_documents card any time it isn't verified yet. */
  canUploadDocuments?: boolean
  /** ai_document_verification only: HR can (re-)run the AI cross-check while unlocked and unverified. */
  canRunAiVerification?: boolean
  /** ai_document_verification only: the stored cross-check result, once run. */
  aiVerification?: AiVerificationSummary | null
  /** hr_approval only: HR/Administrator can (re-)generate the AI profile entry while unlocked and unverified. */
  canGenerateHrProfile?: boolean
  /** hr_approval only: the AI-generated Knowledge Base profile, once generated — HR reviews this,
   * then uses the regular Verify button (canVerify/onVerify) to push it to 'verified'. */
  hrProfileEntry?: HrProfileEntrySummary | null
  /** manager_approval only: the AI-generated team/date/role report, once IT approves it from their
   * Tasks page — display-only here (both HR and the employee can see it), no action button. */
  managerApprovalReport?: ManagerApprovalReportSummary | null
  /** it_account_creation only: the AI-generated account/access summary, once IT generates it from
   * their Tasks page — display-only here. Unlike managerApprovalReport, the employee's own copy of
   * this only ever arrives non-null once HR has ALSO verified the step (enforced server-side). */
  itAccountCredentials?: ItAccountCredentialsSummary | null
  /** asset_allocation only: the AI-generated standard-asset-kit summary, generated up front on
   * Notify (no "Review" click involved) — display-only here, same as managerApprovalReport.
   * Diego's own Approve button lives on his Tasks page, not on this timeline. */
  assetAllocationSummary?: SimpleAiSummary | null
  /** it_verification only: the AI-generated final sign-off summary — only exists once
   * it_account_creation AND asset_allocation are both verified. Display-only here, same shape as
   * assetAllocationSummary. */
  itVerificationSummary?: SimpleAiSummary | null
}

export type DocumentFieldDef = { key: string; label: string; isDate?: boolean }

export type DocumentChecklistItem = {
  type: string
  label: string
  description: string
  uploaded: boolean
  fieldDefs: DocumentFieldDef[]
  fields?: Record<string, string>
  /** The `accept` attribute for this document's file input. */
  fileAccept: string
  /** The real uploaded file, once there is one — powers the View modal's preview/open-file action. */
  fileName?: string
  fileMimeType?: string
  /** `data:<mime>;base64,<data>` — small enough for this demo's file sizes to just inline. */
  fileDataUrl?: string
}

export type UploadedFileInput = { name: string; mimeType: string; dataBase64: string }

export type DocumentUploadSubmission = { documentType: string; fields: Record<string, string>; file: UploadedFileInput }

export type AiFieldComparison = {
  label: string
  documentLabel: string
  submittedValue: string
  documentValue: string
  match: boolean
}

export type AiVerificationSummary = {
  overallStatus: 'match' | 'partial' | 'mismatch'
  summary: string
  details: AiFieldComparison[]
  runAt: string
}

export type HrProfileEntrySummary = {
  markdown: string
  summary: string
  documentName: string
  generatedAt: string
}

export type ManagerApprovalReportSummary = {
  markdown: string
  summary: string
  teamName: string
  startDate: string
  roleTitle: string
  generatedAt: string
}

export type ItAccountCredentialsSummary = {
  markdown: string
  summary: string
  email: string
  generatedAt: string
}

/** Shared shape for asset_allocation's and it_verification's AI summary — plain prose, no
 * markdown/headline split like the reports above (there's no separate "review" step to summarize
 * on this timeline, just the one generated text). */
export type SimpleAiSummary = {
  summaryText: string
  generatedAt: string
}

const statusConfig = {
  completed: {
    label: 'Completed',
    badge: 'bg-[#e4f7ec] text-[#1f8a52]',
    ring: 'bg-[#1f8a52] text-white',
    icon: Check,
  },
  'in-progress': {
    label: 'In Progress',
    badge: 'bg-yellow-soft text-yellow-ink',
    ring: 'bg-yellow text-yellow-ink',
    icon: Loader2,
  },
  pending: {
    label: 'Pending',
    badge: 'bg-secondary text-muted-foreground',
    ring: 'bg-secondary text-muted-foreground',
    icon: Circle,
  },
} as const

const ADHOC_DEPARTMENTS = ['IT', 'Finance', 'Legal'] as const
type AdhocDepartment = (typeof ADHOC_DEPARTMENTS)[number]

export type AdhocStepSubmission = {
  title: string
  description?: string
  departmentName: AdhocDepartment
  insertAfterStepId: string
  subtaskTitles?: string[]
}

export type EmployeeDetailsFormInput = {
  fullName: string
  email: string
  phone: string
  address?: string
  roleTitle: string
  department: string
  startDate: string
}

type Employee = { name: string; role: string; date: string; label: string }

/** Testing-only controls (Reset Last Step) never render in a production build, regardless of who's viewing. */
const DEV_CONTROLS_ENABLED = process.env.NODE_ENV !== 'production'

export function WorkflowTimeline({
  employee,
  steps,
  canManage = false,
  onNotify,
  onAddAdhocStep,
  onVerify,
  onFillDetails,
  onUploadDocument,
  onRunAiVerification,
  onGenerateHrProfile,
  onResetLastStep,
}: {
  employee: Employee
  steps: WorkflowStep[]
  /** Only HR/Administrator get Notify/Verify buttons and the "+ Add Task" affordance — everyone else sees a read-only timeline. */
  canManage?: boolean
  onNotify?: (stepId: string) => Promise<void>
  onAddAdhocStep?: (input: AdhocStepSubmission) => Promise<void>
  onVerify?: (stepId: string, comment?: string) => Promise<void>
  /** Only set for the Employee viewing their own workflow — powers the employee_details "Fill in Details" form. */
  onFillDetails?: (stepId: string, input: EmployeeDetailsFormInput) => Promise<void>
  /** Only set for the Employee viewing their own workflow — powers the upload_documents checklist. */
  onUploadDocument?: (stepId: string, submission: DocumentUploadSubmission) => Promise<void>
  /** Only set for HR/Administrator — triggers the ai_document_verification cross-check. */
  onRunAiVerification?: (stepId: string) => Promise<void>
  /** Only set for HR/Administrator — (re-)generates the hr_approval AI profile entry. Pushing the
   * step to 'verified' afterward uses the regular onVerify, not a dedicated action. */
  onGenerateHrProfile?: (stepId: string) => Promise<void>
  /** Only set for the Employee viewing their own workflow, and only wired up outside production —
   * undoes just the single furthest-along verified step so it can be redone with different data. */
  onResetLastStep?: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState<number | null>(
    steps.findIndex((s) => s.status === 'in-progress'),
  )
  const [detailStep, setDetailStep] = useState<WorkflowStep | null>(null)
  const [notifyingStepId, setNotifyingStepId] = useState<string | null>(null)
  const [notifyError, setNotifyError] = useState<{ stepId: string; message: string } | null>(null)
  const [addAfterStepId, setAddAfterStepId] = useState<string | null>(null)
  const [verifyTarget, setVerifyTarget] = useState<WorkflowStep | null>(null)
  const [fillDetailsTarget, setFillDetailsTarget] = useState<WorkflowStep | null>(null)
  const [aiRunningStepId, setAiRunningStepId] = useState<string | null>(null)
  const [aiRunError, setAiRunError] = useState<{ stepId: string; message: string } | null>(null)
  const [hrGeneratingStepId, setHrGeneratingStepId] = useState<string | null>(null)
  const [hrGenerateError, setHrGenerateError] = useState<{ stepId: string; message: string } | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const completed = steps.filter((s) => s.status === 'completed').length
  const percent = Math.round((completed / steps.length) * 100)

  async function handleNotify(stepId: string) {
    if (!onNotify) return
    setNotifyingStepId(stepId)
    setNotifyError(null)
    try {
      await onNotify(stepId)
    } catch (error) {
      setNotifyError({ stepId, message: error instanceof Error ? error.message : 'Failed to notify' })
    } finally {
      setNotifyingStepId(null)
    }
  }

  async function handleRunAiVerification(stepId: string) {
    if (!onRunAiVerification) return
    setAiRunningStepId(stepId)
    setAiRunError(null)
    try {
      await onRunAiVerification(stepId)
    } catch (error) {
      setAiRunError({ stepId, message: error instanceof Error ? error.message : 'Failed to run AI verification' })
    } finally {
      setAiRunningStepId(null)
    }
  }

  async function handleGenerateHrProfile(stepId: string) {
    if (!onGenerateHrProfile) return
    setHrGeneratingStepId(stepId)
    setHrGenerateError(null)
    try {
      await onGenerateHrProfile(stepId)
    } catch (error) {
      setHrGenerateError({ stepId, message: error instanceof Error ? error.message : 'Failed to generate profile entry' })
    } finally {
      setHrGeneratingStepId(null)
    }
  }

  async function handleResetLastStep() {
    if (!onResetLastStep) return
    setResetting(true)
    setResetError(null)
    try {
      await onResetLastStep()
      setResetConfirmOpen(false)
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Failed to reset step')
    } finally {
      setResetting(false)
    }
  }

  const lastCompletedStep = [...steps].reverse().find((s) => s.status === 'completed')

  return (
    <div className="space-y-6">
      <Link
        href="/automation"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Automation
      </Link>

      {/* Employee info */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-blue-ink">
              {employee.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </div>
            <div>
              <span className="rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-semibold text-yellow-ink">
                {employee.label}
              </span>
              <h2 className="mt-1.5 text-lg font-semibold text-foreground">{employee.name}</h2>
              <p className="text-sm text-muted-foreground">{employee.role}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:gap-8">
            <Stat icon={Briefcase} label="Role" value={employee.role.split(' ')[0]} />
            <Stat icon={Calendar} label="Started" value={employee.date} />
            <Stat icon={User} label="Steps" value={`${completed}/${steps.length}`} />
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span className="text-muted-foreground">Overall progress</span>
            <span className="text-foreground">{percent}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <ol className="relative space-y-4">
        {steps.map((step, i) => {
          const config = statusConfig[step.status]
          const StatusIcon = config.icon
          const isOpen = expanded === i
          const isLast = i === steps.length - 1
          const isNotifying = notifyingStepId === step.id
          return (
            <li key={step.id} className="relative">
              <div className="relative pl-14">
                {!isLast ? (
                  <span
                    className={cn(
                      'absolute left-[22px] top-11 h-[calc(100%+1rem)] w-0.5',
                      step.status === 'completed' ? 'bg-primary/40' : 'bg-border',
                    )}
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    'absolute left-0 top-2 flex h-11 w-11 items-center justify-center rounded-2xl shadow-soft',
                    config.ring,
                  )}
                >
                  <StatusIcon
                    className={cn('h-5 w-5', step.status === 'in-progress' && 'animate-spin')}
                  />
                </span>

                <div className="rounded-3xl border border-border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                            config.badge,
                          )}
                        >
                          {config.label}
                        </span>
                        {step.tag ? (
                          <span className="rounded-full bg-blue px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
                            {step.tag}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                      {step.subLabel ? (
                        <p className="mt-1 text-xs font-medium text-yellow-ink">{step.subLabel}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canManage && step.canNotify ? (
                        <button
                          onClick={() => handleNotify(step.id)}
                          disabled={isNotifying}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
                        >
                          {isNotifying ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Bell className="h-3.5 w-3.5" />
                          )}
                          Notify {step.notifyLabel ?? step.departmentName}
                        </button>
                      ) : null}
                      {canManage && step.canVerify && onVerify ? (
                        <button
                          onClick={() => setVerifyTarget(step)}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1f8a52] px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Verify
                        </button>
                      ) : null}
                      {step.canFillDetails && onFillDetails ? (
                        <button
                          onClick={() => setFillDetailsTarget(step)}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {step.submittedDetails ? 'Edit Details' : 'Fill in Details'}
                        </button>
                      ) : null}
                      {canManage && step.canRunAiVerification && onRunAiVerification ? (
                        <button
                          onClick={() => handleRunAiVerification(step.id)}
                          disabled={aiRunningStepId === step.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-blue-ink shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
                        >
                          {aiRunningStepId === step.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {step.aiVerification ? 'Re-run AI Verification' : 'Run AI Verification'}
                        </button>
                      ) : null}
                      {canManage && step.canGenerateHrProfile && onGenerateHrProfile ? (
                        <button
                          onClick={() => handleGenerateHrProfile(step.id)}
                          disabled={hrGeneratingStepId === step.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-blue-ink shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
                        >
                          {hrGeneratingStepId === step.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {step.hrProfileEntry ? 'Regenerate Profile Entry' : 'Generate Profile Entry'}
                        </button>
                      ) : null}
                      <button
                        onClick={() => setExpanded(isOpen ? null : i)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Expand step"
                      >
                        <ChevronDown
                          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                        />
                      </button>
                    </div>
                  </div>

                  {notifyError?.stepId === step.id ? (
                    <p className="mt-2 text-xs font-medium text-destructive">{notifyError.message}</p>
                  ) : null}
                  {aiRunError?.stepId === step.id ? (
                    <p className="mt-2 text-xs font-medium text-destructive">{aiRunError.message}</p>
                  ) : null}
                  {hrGenerateError?.stepId === step.id ? (
                    <p className="mt-2 text-xs font-medium text-destructive">{hrGenerateError.message}</p>
                  ) : null}

                  {step.documentChecklist ? (
                    <div className="mt-4 border-t border-border pt-4">
                      <DocumentChecklist
                        items={step.documentChecklist}
                        canEdit={!!step.canUploadDocuments}
                        onUpload={
                          onUploadDocument
                            ? (documentType, fields, file) => onUploadDocument(step.id, { documentType, fields, file })
                            : undefined
                        }
                      />
                    </div>
                  ) : null}

                  {isOpen && !step.documentChecklist ? (
                    <div className="mt-4 border-t border-border pt-4">
                      {step.hrProfileEntry ? (
                        <HrProfileEntryPanel entry={step.hrProfileEntry} />
                      ) : step.managerApprovalReport ? (
                        <ManagerApprovalReportPanel report={step.managerApprovalReport} />
                      ) : step.itAccountCredentials ? (
                        <ItAccountCredentialsPanel report={step.itAccountCredentials} />
                      ) : step.assetAllocationSummary ? (
                        <SimpleAiSummaryPanel summary={step.assetAllocationSummary} badgeLabel="Standard asset kit" />
                      ) : step.itVerificationSummary ? (
                        <SimpleAiSummaryPanel summary={step.itVerificationSummary} badgeLabel="IT sign-off confirmation" />
                      ) : step.aiVerification ? (
                        <AiVerificationPanel summary={step.aiVerification} />
                      ) : step.submittedDetails ? (
                        <SubmittedDetailsList fields={step.submittedDetails} />
                      ) : (
                        <p className="text-sm leading-relaxed text-muted-foreground">{step.details}</p>
                      )}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          {step.meta}
                        </span>
                        <button
                          onClick={() => setDetailStep(step)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-blue-ink transition-transform duration-200 hover:-translate-y-0.5"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View Details
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {step.verificationComment ? (
                    <div className="mt-4 rounded-2xl bg-yellow-soft px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">HR Note</p>
                      <p className="mt-1 text-sm text-foreground">{step.verificationComment}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              {canManage && onAddAdhocStep && !isLast ? (
                <div className="relative flex justify-center py-1">
                  <button
                    onClick={() => setAddAfterStepId(step.id)}
                    aria-label={`Add a task after ${step.title}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-40 shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:text-blue-ink hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>

      {DEV_CONTROLS_ENABLED && onResetLastStep ? (
        <div className="rounded-3xl border border-dashed border-border bg-secondary/40 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dev testing only</p>
          {lastCompletedStep ? (
            <>
              <p className="mt-1.5 text-sm text-foreground">
                Reset <span className="font-semibold">{lastCompletedStep.title}</span> so you can redo it with different data.
                Nothing before it is affected.
              </p>
              <button
                onClick={() => {
                  setResetError(null)
                  setResetConfirmOpen(true)
                }}
                className="mt-3 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-muted-foreground shadow-soft transition-colors hover:text-foreground"
              >
                Reset Last Step
              </button>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">No completed step to reset yet.</p>
          )}
        </div>
      ) : null}

      {detailStep ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm"
            onClick={() => setDetailStep(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lift"
          >
            <div className="flex items-start justify-between">
              <div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                    statusConfig[detailStep.status].badge,
                  )}
                >
                  {statusConfig[detailStep.status].label}
                </span>
                <h2 className="mt-2 text-lg font-semibold text-foreground">{detailStep.title}</h2>
              </div>
              <button
                onClick={() => setDetailStep(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            {detailStep.aiVerification ? (
              <div className="mt-4">
                <AiVerificationPanel summary={detailStep.aiVerification} />
              </div>
            ) : detailStep.submittedDetails ? (
              <div className="mt-4">
                <SubmittedDetailsList fields={detailStep.submittedDetails} />
              </div>
            ) : (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{detailStep.details}</p>
            )}
            {detailStep.verificationComment ? (
              <div className="mt-4 rounded-2xl bg-yellow-soft px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-yellow-ink">HR Note</p>
                <p className="mt-1 text-sm text-foreground">{detailStep.verificationComment}</p>
              </div>
            ) : null}
            <div className="mt-4 rounded-2xl bg-secondary px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">{detailStep.meta}</p>
            </div>
            <button
              onClick={() => setDetailStep(null)}
              className="mt-6 w-full rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {addAfterStepId && onAddAdhocStep ? (
        <AddAdhocStepModal
          onClose={() => setAddAfterStepId(null)}
          onSubmit={async (input) => {
            await onAddAdhocStep({ ...input, insertAfterStepId: addAfterStepId })
            setAddAfterStepId(null)
          }}
        />
      ) : null}

      {verifyTarget && onVerify ? (
        <VerifyStepModal
          step={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          onConfirm={async (comment) => {
            await onVerify(verifyTarget.id, comment)
            setVerifyTarget(null)
          }}
        />
      ) : null}

      {fillDetailsTarget && onFillDetails ? (
        <FillEmployeeDetailsModal
          step={fillDetailsTarget}
          onClose={() => setFillDetailsTarget(null)}
          onSubmit={async (input) => {
            await onFillDetails(fillDetailsTarget.id, input)
            setFillDetailsTarget(null)
          }}
        />
      ) : null}

      {resetConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={() => setResetConfirmOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift"
          >
            <h2 className="text-lg font-semibold text-foreground">Reset this step?</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This clears its data{lastCompletedStep ? ` (${lastCompletedStep.title})` : ''} so you can resubmit it. Earlier steps
              are not affected.
            </p>
            {resetError ? <p className="text-xs font-medium text-destructive">{resetError}</p> : null}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetLastStep}
                disabled={resetting}
                className="flex-1 rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
              >
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function VerifyStepModal({
  step,
  onClose,
  onConfirm,
}: {
  step: WorkflowStep
  onClose: () => void
  onConfirm: (comment?: string) => Promise<void>
}) {
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(comment.trim() || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-[#e4f7ec] px-2.5 py-0.5 text-[11px] font-semibold text-[#1f8a52]">
              Verify
            </span>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Confirm that {step.departmentName} has completed this step correctly. Once verified, this step is locked
          in and the employee&apos;s progress updates.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Comment (optional)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Add a note for the record"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 rounded-xl bg-[#1f8a52] px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Read-only "label: value" rendering of a step's real submitted data (employee_details today),
 * shared between the inline expand panel and the "View Details" modal. */
function SubmittedDetailsList({ fields }: { fields: Record<string, string> }) {
  return (
    <dl className="space-y-2">
      {Object.entries(fields).map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 rounded-2xl bg-secondary px-4 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function FillEmployeeDetailsModal({
  step,
  onClose,
  onSubmit,
}: {
  step: WorkflowStep
  onClose: () => void
  onSubmit: (input: EmployeeDetailsFormInput) => Promise<void>
}) {
  const isEditing = !!step.submittedDetails
  const [fullName, setFullName] = useState(step.prefill?.fullName ?? '')
  const [email, setEmail] = useState(step.prefill?.email ?? '')
  const [phone, setPhone] = useState(step.prefill?.phone ?? '')
  const [address, setAddress] = useState(step.prefill?.address ?? '')
  const [roleTitle, setRoleTitle] = useState(step.prefill?.roleTitle ?? '')
  const [department, setDepartment] = useState(step.prefill?.department ?? '')
  const [startDate, setStartDate] = useState(step.prefill?.startDate ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !phone.trim() || !roleTitle.trim() || !department.trim() || !startDate) {
      setError('Full Name, Email, Phone, Role/Title, Department, and Start Date are required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        roleTitle: roleTitle.trim(),
        department: department.trim(),
        startDate,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
              {isEditing ? 'Edit Details' : 'Fill in Details'}
            </span>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Full Name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Address (optional)</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Role / Title</label>
          <input
            value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            placeholder="e.g. Product Designer"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Department</label>
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : isEditing ? 'Save Changes' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The employee's 3-item document checklist for upload_documents — each row's Upload/Edit button
 * opens DocumentUploadModal for just that document type. Read-only (no buttons) for HR viewing it. */
function DocumentChecklist({
  items,
  canEdit,
  onUpload,
}: {
  items: DocumentChecklistItem[]
  canEdit: boolean
  onUpload?: (documentType: string, fields: Record<string, string>, file: UploadedFileInput) => Promise<void>
}) {
  const [editTarget, setEditTarget] = useState<DocumentChecklistItem | null>(null)
  const [viewTarget, setViewTarget] = useState<DocumentChecklistItem | null>(null)

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.type} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                item.uploaded ? 'bg-[#e4f7ec] text-[#1f8a52]' : 'bg-background text-muted-foreground',
              )}
            >
              {item.uploaded ? 'Uploaded' : 'Not uploaded'}
            </span>
            {canEdit && onUpload ? (
              <button
                type="button"
                onClick={() => setEditTarget(item)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
              >
                <Upload className="h-3.5 w-3.5" />
                {item.uploaded ? 'Edit' : 'Upload'}
              </button>
            ) : item.uploaded ? (
              <button
                type="button"
                onClick={() => setViewTarget(item)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-blue-ink transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </button>
            ) : null}
          </div>
        </div>
      ))}

      {editTarget && onUpload ? (
        <DocumentUploadModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={async (fields, file) => {
            await onUpload(editTarget.type, fields, file)
            setEditTarget(null)
          }}
        />
      ) : null}

      {viewTarget ? <DocumentViewModal item={viewTarget} onClose={() => setViewTarget(null)} /> : null}
    </div>
  )
}

/** Read-only view of one uploaded document — the real file (image preview or an open-file link
 * for anything else) plus its typed fields, if any. What HR (and anyone without edit rights) sees
 * instead of the Edit form, so "Uploaded" isn't just a status badge with nothing behind it. */
function DocumentViewModal({ item, onClose }: { item: DocumentChecklistItem; onClose: () => void }) {
  const isImage = item.fileMimeType?.startsWith('image/')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-[#e4f7ec] px-2.5 py-0.5 text-[11px] font-semibold text-[#1f8a52]">Uploaded</span>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{item.label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {item.fileDataUrl ? (
          isImage ? (
            <img
              src={item.fileDataUrl}
              alt={item.fileName ?? item.label}
              className="max-h-72 w-full rounded-2xl border border-border object-contain"
            />
          ) : (
            <a
              href={item.fileDataUrl}
              target="_blank"
              rel="noreferrer"
              download={item.fileName}
              className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm font-semibold text-blue-ink hover:underline"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.fileName ?? 'Open file'}</span>
            </a>
          )
        ) : null}

        {item.fieldDefs.length > 0 ? (
          <SubmittedDetailsList fields={Object.fromEntries(item.fieldDefs.map((f) => [f.label, item.fields?.[f.key] ?? '—']))} />
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
        >
          Close
        </button>
      </div>
    </div>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function DocumentUploadModal({
  item,
  onClose,
  onSubmit,
}: {
  item: DocumentChecklistItem
  onClose: () => void
  onSubmit: (fields: Record<string, string>, file: UploadedFileInput) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.fieldDefs.map((f) => [f.key, item.fields?.[f.key] ?? ''])),
  )
  // Picking a new file is optional when editing (keep the existing one), required on first upload.
  const [newFile, setNewFile] = useState<{ name: string; mimeType: string; dataBase64: string; previewUrl: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewUrl = newFile?.previewUrl ?? item.fileDataUrl ?? null
  const previewName = newFile?.name ?? item.fileName ?? null
  const previewMimeType = newFile?.mimeType ?? item.fileMimeType ?? ''

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setNewFile({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        previewUrl: dataUrl,
      })
      setError(null)
    } catch {
      setError('Could not read that file — please try another.')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (item.fieldDefs.some((f) => !values[f.key]?.trim())) {
      setError('All fields are required')
      return
    }
    const fileToSend =
      newFile ??
      (item.fileDataUrl && item.fileName && item.fileMimeType
        ? { name: item.fileName, mimeType: item.fileMimeType, dataBase64: item.fileDataUrl.slice(item.fileDataUrl.indexOf(',') + 1) }
        : null)
    if (!fileToSend) {
      setError('Please choose a file to upload')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(values, { name: fileToSend.name, mimeType: fileToSend.mimeType, dataBase64: fileToSend.dataBase64 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
              {item.uploaded ? 'Edit Document' : 'Upload Document'}
            </span>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{item.label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">File from your computer</label>
          <input
            type="file"
            accept={item.fileAccept}
            onChange={handleFileChange}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground focus:border-primary"
          />
          {previewUrl ? (
            previewMimeType.startsWith('image/') ? (
              <img src={previewUrl} alt={previewName ?? 'Preview'} className="mt-2 h-28 w-28 rounded-xl border border-border object-cover" />
            ) : (
              <p className="mt-1 truncate text-xs text-muted-foreground">Selected: {previewName}</p>
            )
          ) : null}
        </div>

        {item.fieldDefs.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
            <input
              type={f.isDate ? 'date' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        ))}

        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {submitting ? 'Uploading…' : item.uploaded ? 'Save Changes' : 'Upload'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The AI cross-check result for ai_document_verification — shown inline once run, and reused in
 * the "View Details" modal. */
function AiVerificationPanel({ summary }: { summary: AiVerificationSummary }) {
  const badge =
    summary.overallStatus === 'match'
      ? { text: 'All fields matched', className: 'bg-[#e4f7ec] text-[#1f8a52]' }
      : { text: summary.overallStatus === 'partial' ? 'Some mismatches found' : 'Mismatches found', className: 'bg-yellow-soft text-yellow-ink' }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', badge.className)}>{badge.text}</span>
        <span className="text-xs text-muted-foreground">Run {formatWorkflowDate(summary.runAt)}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{summary.summary}</p>
      {summary.details.length > 0 ? (
        <div className="space-y-1.5">
          {summary.details.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary px-4 py-2.5 text-xs">
              <span className="font-medium text-foreground">
                {d.label} <span className="text-muted-foreground">({d.documentLabel})</span>
              </span>
              <span className={d.match ? 'font-medium text-[#1f8a52]' : 'font-medium text-destructive'}>
                {d.match ? `✓ ${d.documentValue}` : `✗ "${d.documentValue}" vs "${d.submittedValue}"`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function HrProfileEntryPanel({ entry }: { entry: HrProfileEntrySummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
          Added to Knowledge Base
        </span>
        <span className="text-xs text-muted-foreground">Generated {formatWorkflowDate(entry.generatedAt)}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{entry.summary}</p>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Saved as <span className="font-semibold text-foreground">{entry.documentName}</span> — review the full entry below,
          then use Verify to confirm and unlock the next step.
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-3 text-xs leading-relaxed text-foreground">
          {entry.markdown}
        </pre>
      </div>
    </div>
  )
}

function ManagerApprovalReportPanel({ report }: { report: ManagerApprovalReportSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
          Team &amp; role assignment approved
        </span>
        <span className="text-xs text-muted-foreground">Generated {formatWorkflowDate(report.generatedAt)}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-3 text-xs leading-relaxed text-foreground">
        {report.markdown}
      </pre>
    </div>
  )
}

function ItAccountCredentialsPanel({ report }: { report: ItAccountCredentialsSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">
          Account &amp; access confirmed
        </span>
        <span className="text-xs text-muted-foreground">Generated {formatWorkflowDate(report.generatedAt)}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{report.summary}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-3 text-xs leading-relaxed text-foreground">
        {report.markdown}
      </pre>
    </div>
  )
}

/** Read-only display for asset_allocation's and it_verification's AI summary — no markdown/headline
 * split (just the one generated paragraph), unlike the report panels above. Diego's own Approve
 * button lives on his Tasks page, not here. */
function SimpleAiSummaryPanel({ summary, badgeLabel }: { summary: SimpleAiSummary; badgeLabel: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-blue-ink">{badgeLabel}</span>
        <span className="text-xs text-muted-foreground">Generated {formatWorkflowDate(summary.generatedAt)}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{summary.summaryText}</p>
    </div>
  )
}

function AddAdhocStepModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: Omit<AdhocStepSubmission, 'insertAfterStepId'>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [departmentName, setDepartmentName] = useState<AdhocDepartment>('IT')
  const [subtasks, setSubtasks] = useState<string[]>([''])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        departmentName,
        subtaskTitles: subtasks.map((s) => s.trim()).filter(Boolean),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add task')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-foreground">Add task</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Confirm background check re-verification"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional details for this task"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Department</label>
          <select
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value as AdhocDepartment)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          >
            {ADHOC_DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Subtasks (optional)</label>
          <div className="space-y-2">
            {subtasks.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={(e) =>
                    setSubtasks((prev) => prev.map((s, i) => (i === index ? e.target.value : s)))
                  }
                  placeholder={`Subtask ${index + 1}`}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
                {subtasks.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setSubtasks((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remove subtask"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSubtasks((prev) => [...prev, ''])}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-ink"
          >
            <Plus className="h-3.5 w-3.5" />
            Add subtask
          </button>
        </div>

        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {submitting ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User
  label: string
  value: string
}) {
  return (
    <div className="text-center sm:text-left">
      <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground sm:justify-start">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

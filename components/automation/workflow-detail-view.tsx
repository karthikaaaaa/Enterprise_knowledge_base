'use client'

import useSWR from 'swr'
import { useAuth } from '@/components/auth/auth-provider'
import { authedFetcher, authedPost, ApiError } from '@/lib/api-client'
import {
  WorkflowTimeline,
  type WorkflowStep,
  type StepStatus,
  type AdhocStepSubmission,
  type EmployeeDetailsFormInput,
  type DocumentFieldDef,
  type DocumentChecklistItem,
  type DocumentUploadSubmission,
  type AiVerificationSummary,
  type ManagerApprovalReportSummary,
  type ItAccountCredentialsSummary,
  type SimpleAiSummary,
} from '@/components/automation/workflow-timeline'
import type { WorkflowDetail, WorkflowStepDetail } from '@/lib/workflow-view'
import type { EmployeeDetailSubmission, EmployeeDocument } from '@/lib/workflow-store'
import { humanizeStepName, formatWorkflowDate as formatDate } from '@/lib/workflow-format'

// Manager approval now runs through the same Notify → Tasks → HR-verify flow as IT/Finance/Legal
// (see DEPARTMENT_FIXED below), so it's no longer HR-owned — only hr_approval itself stays here.
const HR_OWNED_DEPARTMENTS = new Set(['HR'])
const DEPARTMENT_FIXED = new Set(['IT', 'Finance', 'Legal', 'Manager'])
// Only HR/Administrator get the Notify button and "+ Add Task" affordance — Manager and Employee stay read-only.
const CAN_MANAGE_ROLES = new Set(['admin', 'hr'])
const EMPLOYEE_DETAILS_STEP = 'employee_details'
const UPLOAD_DOCUMENTS_STEP = 'upload_documents'
const AI_DOCUMENT_VERIFICATION_STEP = 'ai_document_verification'
const HR_APPROVAL_STEP = 'hr_approval'
const MANAGER_APPROVAL_STEP = 'manager_approval'
const IT_ACCOUNT_CREATION_STEP = 'it_account_creation'
const ASSET_ALLOCATION_STEP = 'asset_allocation'
const IT_VERIFICATION_STEP = 'it_verification'

// Mirrors REQUIRED_DOCUMENT_TYPES in lib/workflow-actions.ts. Duplicated here because that module
// pulls in the sqlite-backed store and can't be imported into a client component — keep the type,
// label, description, and field keys in sync if that list ever changes.
const DOCUMENT_TYPE_DEFS: { type: string; label: string; description: string; fieldDefs: DocumentFieldDef[]; fileAccept: string }[] = [
  {
    type: 'government_id',
    label: 'Government ID',
    description: 'A photo ID such as a passport or driver’s license',
    fieldDefs: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'address', label: 'Address' },
    ],
    fileAccept: 'image/*,.pdf,application/pdf',
  },
  {
    type: 'offer_letter',
    label: 'Offer Letter',
    description: 'The signed offer letter confirming role and start date',
    fieldDefs: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'roleTitle', label: 'Role / Title' },
      { key: 'department', label: 'Department' },
      { key: 'startDate', label: 'Start Date', isDate: true },
    ],
    fileAccept: 'image/*,.pdf,application/pdf',
  },
  {
    type: 'address_proof',
    label: 'Proof of Address',
    description: 'A recent utility bill or bank statement showing your address',
    fieldDefs: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'address', label: 'Address' },
    ],
    fileAccept: 'image/*,.pdf,application/pdf',
  },
  {
    type: 'photo',
    label: 'Photo',
    description: 'A recent photo of yourself',
    fieldDefs: [],
    fileAccept: 'image/*',
  },
]

type ApiFieldComparison = {
  field: string
  label: string
  documentLabel: string
  submittedValue: string
  documentValue: string
  match: boolean
}

type ApiAiResult = {
  overallStatus: 'match' | 'partial' | 'mismatch'
  summary: string
  details: ApiFieldComparison[]
  runAt: string
}

type ApiHrProfileEntry = {
  markdown: string
  summary: string
  documentName: string
  generatedAt: string
}

type ApiManagerApprovalReport = {
  markdown: string
  summary: string
  teamName: string
  startDate: string
  roleTitle: string
  generatedAt: string
}

type ApiItAccountReport = {
  markdown: string
  summary: string
  email: string
  generatedAt: string
}

type ApiSimpleSummary = {
  summaryText: string
  generatedAt: string
}

function statusText(approvalStatus: string | undefined, departmentName: string) {
  const deptOwned = !HR_OWNED_DEPARTMENTS.has(departmentName)
  switch (approvalStatus) {
    case 'allocated':
      return deptOwned ? `Notified — awaiting ${departmentName}` : 'Allocated'
    case 'in_progress':
      return deptOwned ? `In progress with ${departmentName}` : 'In progress'
    case 'completed':
      return deptOwned ? `Completed by ${departmentName} — awaiting HR verification` : 'Completed — awaiting verification'
    default:
      return 'Not started'
  }
}

function submissionFields(submission: EmployeeDetailSubmission): Record<string, string> {
  return {
    'Full Name': submission.fullName,
    Email: submission.email,
    Phone: submission.phone,
    Address: submission.address ?? '—',
    'Role / Title': submission.roleTitle,
    Department: submission.department,
    'Start Date': formatDate(submission.startDate),
  }
}

function submissionAsRecord(submission: EmployeeDetailSubmission): Record<string, string> {
  return {
    fullName: submission.fullName,
    email: submission.email,
    phone: submission.phone,
    address: submission.address ?? '',
    roleTitle: submission.roleTitle,
    department: submission.department,
    startDate: submission.startDate,
  }
}

function buildDocumentChecklist(
  documents: EmployeeDocument[],
  submission: EmployeeDetailSubmission | null,
): DocumentChecklistItem[] {
  const submissionRecord = submission ? submissionAsRecord(submission) : null
  return DOCUMENT_TYPE_DEFS.map((def) => {
    const doc = documents.find((d) => d.documentType === def.type)
    const fields =
      doc?.extractedFields ??
      (submissionRecord ? Object.fromEntries(def.fieldDefs.map((f) => [f.key, submissionRecord[f.key] ?? ''])) : undefined)
    return {
      type: def.type,
      label: def.label,
      description: def.description,
      uploaded: !!doc,
      fieldDefs: def.fieldDefs,
      fields,
      fileAccept: def.fileAccept,
      fileName: doc?.fileName,
      fileMimeType: doc?.fileMimeType,
      fileDataUrl: doc ? `data:${doc.fileMimeType};base64,${doc.fileData}` : undefined,
    }
  })
}

function toAiVerificationSummary(result: ApiAiResult): AiVerificationSummary {
  return {
    overallStatus: result.overallStatus,
    summary: result.summary,
    runAt: result.runAt,
    details: result.details.map((d) => ({
      label: d.label,
      documentLabel: d.documentLabel,
      submittedValue: d.field === 'startDate' ? formatDate(d.submittedValue) : d.submittedValue,
      documentValue: d.field === 'startDate' ? formatDate(d.documentValue) : d.documentValue,
      match: d.match,
    })),
  }
}

function toTimelineStep(
  step: WorkflowStepDetail,
  ctx: {
    isEmployeeViewer: boolean
    canManage: boolean
    employeeDepartment: string | null
    employeeDateOfJoining: string | null
    submission: EmployeeDetailSubmission | null
    documents: EmployeeDocument[] | null
    aiResult: ApiAiResult | null
    hrProfileEntry: ApiHrProfileEntry | null
    managerApprovalReport: ApiManagerApprovalReport | null
    itAccountCredentials: ApiItAccountReport | null
    assetAllocationSummary: ApiSimpleSummary | null
    itVerificationSummary: ApiSimpleSummary | null
  },
): WorkflowStep {
  const approval = step.approval
  const status: StepStatus =
    approval?.status === 'verified' ? 'completed' : approval && approval.status !== 'pending' ? 'in-progress' : 'pending'
  const deptOwned = !HR_OWNED_DEPARTMENTS.has(step.departmentName)
  const isEmployeeDetailsStep = step.stepName === EMPLOYEE_DETAILS_STEP
  const isUploadDocumentsStep = step.stepName === UPLOAD_DOCUMENTS_STEP
  const isAiVerificationStep = step.stepName === AI_DOCUMENT_VERIFICATION_STEP
  const isHrApprovalStep = step.stepName === HR_APPROVAL_STEP
  const isManagerApprovalStep = step.stepName === MANAGER_APPROVAL_STEP
  const isItAccountCreationStep = step.stepName === IT_ACCOUNT_CREATION_STEP
  const isAssetAllocationStep = step.stepName === ASSET_ALLOCATION_STEP
  const isItVerificationStep = step.stepName === IT_VERIFICATION_STEP

  const meta =
    status === 'completed'
      ? approval?.verifiedAt
        ? `Verified ${formatDate(approval.verifiedAt)}`
        : 'Verified'
      : step.locked
        ? 'Locked — waiting on the previous step'
        : (isEmployeeDetailsStep || isUploadDocumentsStep) && ctx.isEmployeeViewer && approval?.status === 'completed'
          ? 'Submitted — awaiting HR review'
          : isHrApprovalStep && approval?.status === 'completed'
            // Never say "Completed" here — the step isn't done until HR clicks Verify, and
            // statusText's generic wording for HR-owned steps says exactly that word.
            ? 'AI profile generated — awaiting HR verification'
            : statusText(approval?.status, step.departmentName)

  return {
    id: step.id,
    stepName: step.stepName,
    title: humanizeStepName(step.stepName),
    description: step.description ?? '',
    status,
    meta,
    details: step.description ?? '',
    // Shown alongside whichever body the card renders (plain details, submittedDetails,
    // documentChecklist, or aiVerification) — previously this only lived inside `details`, which
    // meant it silently disappeared for any step that rendered one of those other views instead.
    verificationComment: step.approval?.comment ?? null,
    submittedDetails: isEmployeeDetailsStep && ctx.submission ? submissionFields(ctx.submission) : null,
    tag: step.isAdhoc ? 'Custom' : undefined,
    subLabel: step.locked
      ? 'Waiting on the previous step'
      : status === 'in-progress' && deptOwned
        ? statusText(approval?.status, step.departmentName)
        : undefined,
    departmentName: step.departmentName,
    // asset_allocation and it_verification are both routed to the Manager role (Diego Ramirez)
    // but their buttons read "Notify IT" regardless — a deliberate display-only override, not
    // tied to who actually gets notified.
    notifyLabel: step.stepName === ASSET_ALLOCATION_STEP || step.stepName === IT_VERIFICATION_STEP ? 'IT' : undefined,
    // Steps run strictly top to bottom — Notify/Verify only become available once every earlier step is verified.
    canNotify: !approval && DEPARTMENT_FIXED.has(step.departmentName) && !step.locked,
    // Verify only ever appears once the step has actually reached 'completed' — via department
    // sign-off (Notify flow), an employee submission, or the AI cross-check run. It must never
    // show while a step is still 'pending' with nothing behind it yet.
    canVerify: !step.locked && approval?.status === 'completed',
    // The employee can fill this in, and keep editing/resubmitting it, right up until HR
    // verifies it — once verified it's locked in, matching every other step's Verify semantics.
    canFillDetails: isEmployeeDetailsStep && ctx.isEmployeeViewer && !step.locked && approval?.status !== 'verified',
    prefill: isEmployeeDetailsStep
      ? ctx.submission
        ? {
            fullName: ctx.submission.fullName,
            email: ctx.submission.email,
            phone: ctx.submission.phone,
            address: ctx.submission.address,
            roleTitle: ctx.submission.roleTitle,
            department: ctx.submission.department,
            startDate: ctx.submission.startDate,
          }
        : { department: ctx.employeeDepartment, startDate: ctx.employeeDateOfJoining }
      : undefined,
    documentChecklist: isUploadDocumentsStep && ctx.documents ? buildDocumentChecklist(ctx.documents, ctx.submission) : undefined,
    canUploadDocuments: isUploadDocumentsStep && ctx.isEmployeeViewer && !step.locked && approval?.status !== 'verified',
    canRunAiVerification: isAiVerificationStep && ctx.canManage && !step.locked && approval?.status !== 'verified',
    aiVerification: isAiVerificationStep && ctx.aiResult ? toAiVerificationSummary(ctx.aiResult) : null,
    // hr_approval follows the same "reach completed, then HR verifies" pattern as every other
    // step: HR generates the AI profile entry (completes it), reviews it, then uses the regular
    // Verify button (canVerify above already covers this generically) to push it to 'verified'.
    canGenerateHrProfile: isHrApprovalStep && ctx.canManage && !step.locked && approval?.status !== 'verified',
    hrProfileEntry: isHrApprovalStep && ctx.hrProfileEntry ? ctx.hrProfileEntry : null,
    // Display-only for manager_approval — IT generates and approves it from their own Tasks page,
    // not here, but both HR and the employee can see the resulting report on this card.
    managerApprovalReport: isManagerApprovalStep && ctx.managerApprovalReport ? ctx.managerApprovalReport : null,
    // Dual-gated server-side (see the credentials route) — HR/Admin/IT can fetch it once
    // 'completed', but the employee's own fetch key below only activates once 'verified', so this
    // stays null for them until HR has verified too.
    itAccountCredentials: isItAccountCreationStep && ctx.itAccountCredentials ? ctx.itAccountCredentials : null,
    // Display-only, like managerApprovalReport — Diego generates (up front, on Notify) and
    // approves asset_allocation from his own Tasks page, not here.
    assetAllocationSummary: isAssetAllocationStep && ctx.assetAllocationSummary ? ctx.assetAllocationSummary : null,
    // Same display-only treatment — only ever non-null once it_account_creation AND
    // asset_allocation are both verified (see maybeGenerateItVerificationSummary).
    itVerificationSummary: isItVerificationStep && ctx.itVerificationSummary ? ctx.itVerificationSummary : null,
  }
}

export function WorkflowDetailView({ workflowId }: { workflowId: string }) {
  const { user } = useAuth()
  const swrKey = user ? `/api/workflows/${workflowId}` : null
  const { data, error, isLoading, mutate } = useSWR<WorkflowDetail>(swrKey, authedFetcher(user?.email))

  const canManage = !!user && CAN_MANAGE_ROLES.has(user.role)
  const isEmployeeViewer = user?.role === 'employee'

  const employeeDetailsStatus = data?.steps.find((s) => s.stepName === EMPLOYEE_DETAILS_STEP)?.approval?.status
  const canSeeSubmission = isEmployeeViewer || canManage
  const submissionKey =
    canSeeSubmission && (employeeDetailsStatus === 'completed' || employeeDetailsStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/employee_details/submission`
      : null
  const { data: submissionData, mutate: mutateSubmission } = useSWR<{ submission: EmployeeDetailSubmission }>(
    submissionKey,
    authedFetcher(user?.email),
  )

  // Unlike the step 1 submission, this is fetched regardless of upload_documents' approval status
  // (even 0-of-3 uploaded is a valid state the checklist needs to render).
  const canSeeDocuments = isEmployeeViewer || canManage
  const documentsKey = canSeeDocuments ? `/api/workflows/${workflowId}/steps/upload_documents/submission` : null
  const { data: documentsData, mutate: mutateDocuments } = useSWR<{ documents: EmployeeDocument[] }>(
    documentsKey,
    authedFetcher(user?.email),
  )

  const aiStepStatus = data?.steps.find((s) => s.stepName === AI_DOCUMENT_VERIFICATION_STEP)?.approval?.status
  const aiResultKey =
    canManage && (aiStepStatus === 'completed' || aiStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/ai_document_verification/result`
      : null
  const { data: aiResultData, mutate: mutateAiResult } = useSWR<{ result: ApiAiResult }>(aiResultKey, authedFetcher(user?.email))

  const hrApprovalStepStatus = data?.steps.find((s) => s.stepName === HR_APPROVAL_STEP)?.approval?.status
  const hrProfileEntryKey =
    canManage && (hrApprovalStepStatus === 'completed' || hrApprovalStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/hr_approval/entry`
      : null
  const { data: hrProfileEntryData, mutate: mutateHrProfileEntry } = useSWR<{ entry: ApiHrProfileEntry }>(
    hrProfileEntryKey,
    authedFetcher(user?.email),
  )

  // Unlike hr_approval's entry, this is visible to the employee too (not just HR) — IT generates
  // and approves it from their own Tasks page, so there's no onGenerate handler needed here.
  const managerApprovalStepStatus = data?.steps.find((s) => s.stepName === MANAGER_APPROVAL_STEP)?.approval?.status
  const managerApprovalReportKey =
    (canManage || isEmployeeViewer) && (managerApprovalStepStatus === 'completed' || managerApprovalStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/manager_approval/report`
      : null
  const { data: managerApprovalReportData, mutate: mutateManagerApprovalReport } = useSWR<{
    report: ApiManagerApprovalReport
  }>(managerApprovalReportKey, authedFetcher(user?.email))

  // Unlike the two fetches above, this one is deliberately role-specific rather than a shared
  // "canManage || isEmployeeViewer" condition: HR/Admin can see it once IT completes it
  // (so there's something to verify), but the employee only gets it once HR has ALSO verified —
  // "the credentials to be sent to the employee login after the hr also verifies" from the request
  // that added this. The credentials route enforces the same split server-side too.
  const itAccountStepStatus = data?.steps.find((s) => s.stepName === IT_ACCOUNT_CREATION_STEP)?.approval?.status
  const itAccountCredentialsKey =
    (canManage && (itAccountStepStatus === 'completed' || itAccountStepStatus === 'verified')) ||
    (isEmployeeViewer && itAccountStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/it_account_creation/credentials`
      : null
  const { data: itAccountCredentialsData, mutate: mutateItAccountCredentials } = useSWR<{ report: ApiItAccountReport }>(
    itAccountCredentialsKey,
    authedFetcher(user?.email),
  )

  // Same shared "canManage || isEmployeeViewer" visibility as manager_approval's report — nothing
  // sensitive in either summary. Diego generates and approves both from his own Tasks page.
  const assetAllocationStepStatus = data?.steps.find((s) => s.stepName === ASSET_ALLOCATION_STEP)?.approval?.status
  const assetAllocationSummaryKey =
    (canManage || isEmployeeViewer) && (assetAllocationStepStatus === 'completed' || assetAllocationStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/asset_allocation/summary`
      : null
  const { data: assetAllocationSummaryData, mutate: mutateAssetAllocationSummary } = useSWR<{ summary: ApiSimpleSummary }>(
    assetAllocationSummaryKey,
    authedFetcher(user?.email),
  )

  const itVerificationStepStatus = data?.steps.find((s) => s.stepName === IT_VERIFICATION_STEP)?.approval?.status
  const itVerificationSummaryKey =
    (canManage || isEmployeeViewer) && (itVerificationStepStatus === 'completed' || itVerificationStepStatus === 'verified')
      ? `/api/workflows/${workflowId}/steps/it_verification/summary`
      : null
  const { data: itVerificationSummaryData, mutate: mutateItVerificationSummary } = useSWR<{ summary: ApiSimpleSummary }>(
    itVerificationSummaryKey,
    authedFetcher(user?.email),
  )

  async function handleNotify(stepId: string) {
    await authedPost<{ step: WorkflowStepDetail }>(`/api/workflows/${workflowId}/steps/${stepId}/notify`, user?.email)
    // Refetch rather than patch just this step: notifying doesn't change any other step's lock
    // state, but keeping one code path for both actions avoids the two drifting apart later.
    await mutate()
  }

  async function handleAddAdhocStep(input: AdhocStepSubmission) {
    const result = await authedPost<{ steps: WorkflowStepDetail[] }>(
      `/api/workflows/${workflowId}/adhoc-steps`,
      user?.email,
      {
        title: input.title,
        description: input.description,
        department_name: input.departmentName,
        insert_after_step_id: input.insertAfterStepId,
        subtask_titles: input.subtaskTitles,
      },
    )
    await mutate((current) => (current ? { ...current, steps: result.steps } : current), { revalidate: false })
  }

  async function handleVerify(stepId: string, comment?: string) {
    await authedPost<{ step: WorkflowStepDetail; workflowStatus: string }>(
      `/api/workflows/${workflowId}/steps/${stepId}/verify`,
      user?.email,
      comment ? { comment } : {},
    )
    // Verifying this step unlocks the next one, so refetch the whole list rather than patch
    // just the verified step — a partial patch would leave the next step's `locked` stale.
    await mutate()
  }

  async function handleFillDetails(stepId: string, input: EmployeeDetailsFormInput) {
    await authedPost(`/api/workflows/${workflowId}/steps/employee_details/submit`, user?.email, {
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      role_title: input.roleTitle,
      department: input.department,
      start_date: input.startDate,
    })
    // The submission GET has its own SWR key that doesn't change on a resubmission (status stays
    // 'completed'), so revalidate it explicitly — otherwise an edit would post successfully but
    // still show the old submitted values until an unrelated refetch happened to occur.
    await Promise.all([mutate(), mutateSubmission()])
  }

  async function handleUploadDocument(stepId: string, submission: DocumentUploadSubmission) {
    await authedPost(`/api/workflows/${workflowId}/steps/upload_documents/submit`, user?.email, {
      document_type: submission.documentType,
      fields: submission.fields,
      file_name: submission.file.name,
      file_mime_type: submission.file.mimeType,
      file_data: submission.file.dataBase64,
    })
    // The documents GET key never changes (it doesn't depend on step status), so it needs an
    // explicit revalidate on every upload, not just the one that completes the checklist.
    await Promise.all([mutate(), mutateDocuments()])
  }

  async function handleRunAiVerification(stepId: string) {
    await authedPost(`/api/workflows/${workflowId}/steps/ai_document_verification/run`, user?.email)
    await Promise.all([mutate(), mutateAiResult()])
  }

  async function handleGenerateHrProfile(_stepId: string) {
    await authedPost(`/api/workflows/${workflowId}/steps/hr_approval/generate`, user?.email)
    await Promise.all([mutate(), mutateHrProfileEntry()])
  }

  async function handleResetLastStep() {
    await authedPost(`/api/workflows/${workflowId}/dev-reset-last-step`, user?.email)
    // The reset can touch several derived data sources (submission, documents, AI result, HR
    // profile entry, manager approval report, IT credentials, asset/IT-verification summaries)
    // depending on which step it undid, so refetch everything rather than guess.
    await Promise.all([
      mutate(),
      mutateSubmission(),
      mutateDocuments(),
      mutateAiResult(),
      mutateHrProfileEntry(),
      mutateManagerApprovalReport(),
      mutateItAccountCredentials(),
      mutateAssetAllocationSummary(),
      mutateItVerificationSummary(),
    ])
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workflow…</p>
  }

  if (error) {
    const apiError = error instanceof ApiError ? error : null
    const message =
      apiError?.status === 404
        ? 'Workflow not found.'
        : apiError?.status === 403
          ? "You don't have access to this workflow."
          : 'Failed to load workflow. Please try again.'
    return <p className="text-sm text-destructive">{message}</p>
  }

  if (!data) return null

  return (
    <WorkflowTimeline
      employee={{
        name: data.employee.name,
        role: data.employee.role,
        date: formatDate(data.createdAt),
        label: data.type === 'onboarding' ? 'New Hire' : 'Exiting',
      }}
      steps={data.steps.map((step) =>
        toTimelineStep(step, {
          isEmployeeViewer,
          canManage,
          employeeDepartment: data.employee.department,
          employeeDateOfJoining: data.employee.dateOfJoining,
          submission: submissionData?.submission ?? null,
          documents: documentsData?.documents ?? (canSeeDocuments ? [] : null),
          aiResult: aiResultData?.result ?? null,
          hrProfileEntry: hrProfileEntryData?.entry ?? null,
          managerApprovalReport: managerApprovalReportData?.report ?? null,
          itAccountCredentials: itAccountCredentialsData?.report ?? null,
          assetAllocationSummary: assetAllocationSummaryData?.summary ?? null,
          itVerificationSummary: itVerificationSummaryData?.summary ?? null,
        }),
      )}
      canManage={canManage}
      onNotify={canManage ? handleNotify : undefined}
      onAddAdhocStep={canManage ? handleAddAdhocStep : undefined}
      onVerify={canManage ? handleVerify : undefined}
      onFillDetails={isEmployeeViewer ? handleFillDetails : undefined}
      onUploadDocument={isEmployeeViewer ? handleUploadDocument : undefined}
      onRunAiVerification={canManage ? handleRunAiVerification : undefined}
      onGenerateHrProfile={canManage ? handleGenerateHrProfile : undefined}
      onResetLastStep={isEmployeeViewer ? handleResetLastStep : undefined}
    />
  )
}

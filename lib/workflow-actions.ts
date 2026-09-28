import {
  getWorkflow,
  getWorkflowSteps,
  listAdhocStepsForWorkflow,
  getRoleByName,
  listUsersByRole,
  getEmployeeById,
  getUserById,
  listSubtaskTemplatesByStep,
  createApproval,
  createSubtask,
  createNotification,
  createAdhocStep,
  createEmployeeDetailSubmission,
  getEmployeeDetailSubmissionByWorkflow,
  createEmployeeDocument,
  listEmployeeDocumentsByWorkflow,
  createDocumentVerificationResult,
  updateApprovalStatus,
  updateWorkflowCurrentStep,
  runInTransaction,
  createHrApprovalProfileEntry,
  getLatestItAccountReport,
  createAssetAllocationSummary,
  getLatestAssetAllocationSummary,
  createItVerificationSummary,
  getLatestItVerificationSummary,
  deleteApprovalsForStep,
  deleteEmployeeDetailSubmissionsForWorkflow,
  deleteEmployeeDocumentsForWorkflow,
  deleteDocumentVerificationResultsForWorkflow,
  deleteHrApprovalProfileEntriesForWorkflow,
  deleteManagerApprovalReportsForWorkflow,
  deleteItAccountReportsForWorkflow,
  type EmployeeDetailSubmission,
} from '@/lib/workflow-store'
import { createEmployeeProfileKbEntry } from '@/lib/hr-approval-kb'
import { generateAssetAllocationSummary } from '@/lib/asset-allocation-report'
import { generateItVerificationSummary } from '@/lib/it-verification-report'
import {
  getWorkflowStepDetail,
  listWorkflowStepDetails,
  getLatestApprovalForStep,
  type WorkflowStepDetail,
} from '@/lib/workflow-view'
import { humanizeStepName } from '@/lib/workflow-format'

const ASSET_ALLOCATION_STEP_NAME = 'asset_allocation'
const IT_ACCOUNT_CREATION_STEP_NAME = 'it_account_creation'
const IT_VERIFICATION_STEP_NAME = 'it_verification'

const DEPARTMENT_FIXED = new Set(['IT', 'Finance', 'Legal', 'Manager'])

export type WorkflowActionError =
  | 'workflow_not_found'
  | 'step_not_found'
  | 'not_department_fixed'
  | 'already_notified'
  | 'department_role_missing'
  | 'invalid_anchor_step'
  | 'not_completed'
  | 'already_verified'
  | 'step_locked'
  | 'already_submitted'

function employeeDisplayName(workflowId: string): string {
  const workflow = getWorkflow(workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  return employee ? `${employee.firstName} ${employee.lastName}` : 'the employee'
}

/** approver_id: the department's one head user (roles/departments aren't many-to-many yet, so first match wins). */
function resolveDepartmentApprover(departmentName: string): { roleId: string; approverId: string | null } | null {
  const role = getRoleByName(departmentName)
  if (!role) return null
  const approverId = listUsersByRole(role.id)[0]?.id ?? null
  return { roleId: role.id, approverId }
}

export async function notifyDepartmentStep(
  workflowId: string,
  stepId: string,
): Promise<{ ok: true; step: WorkflowStepDetail } | { ok: false; error: WorkflowActionError }> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const step = listWorkflowStepDetails(workflowId).find((s) => s.id === stepId)
  if (!step) return { ok: false, error: 'step_not_found' }
  if (!DEPARTMENT_FIXED.has(step.departmentName)) return { ok: false, error: 'not_department_fixed' }

  // Steps run strictly top to bottom — a department can't be notified until every earlier step is verified.
  if (step.locked) return { ok: false, error: 'step_locked' }

  const alreadyNotified = step.approval !== null
  if (alreadyNotified) return { ok: false, error: 'already_notified' }

  const department = resolveDepartmentApprover(step.departmentName)
  if (!department) return { ok: false, error: 'department_role_missing' }

  if (step.stepName === ASSET_ALLOCATION_STEP_NAME) {
    await notifyAssetAllocation(workflowId, step, department)
  } else if (step.stepName === IT_VERIFICATION_STEP_NAME) {
    await notifyItVerification(workflowId, step, department)
  } else {
    const employeeName = employeeDisplayName(workflowId)
    runInTransaction(() => {
      const approval = createApproval({
        workflowId,
        stepId,
        approverId: department.approverId,
        status: 'allocated',
      })
      for (const template of listSubtaskTemplatesByStep(stepId)) {
        createSubtask({ approvalId: approval.id, title: template.title })
      }
      createNotification({
        roleId: department.roleId,
        approvalId: approval.id,
        message: `${humanizeStepName(step.stepName)} needed for ${employeeName}`,
      })
    })
  }

  return { ok: true, step: getWorkflowStepDetail(workflowId, stepId)! }
}

/** asset_allocation has no subtask checklist — a single AI-generated plain-language summary of
 * the standard asset kit (grounded in the employee's real role/department, see
 * lib/asset-allocation-report.ts) that Diego reviews and approves with one button (see
 * task-actions.ts). Generated up front, before the approval row exists, so the summary is already
 * there the moment the task appears in Diego's queue — the approval never auto-completes. */
async function notifyAssetAllocation(
  workflowId: string,
  step: WorkflowStepDetail,
  department: { roleId: string; approverId: string | null },
) {
  const employeeName = employeeDisplayName(workflowId)
  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  const { summaryText } = await generateAssetAllocationSummary({
    fullName: submission?.fullName ?? employeeName,
    roleTitle: submission?.roleTitle ?? 'their role',
    department: submission?.department ?? 'their department',
  })

  runInTransaction(() => {
    const approval = createApproval({ workflowId, stepId: step.id, approverId: department.approverId, status: 'allocated' })
    createAssetAllocationSummary({ workflowId, stepId: step.id, approvalId: approval.id, summaryText })
    createNotification({
      roleId: department.roleId,
      approvalId: approval.id,
      message: `${humanizeStepName(step.stepName)} needed for ${employeeName}`,
    })
  })
}

/** it_verification has no subtask checklist either — same single-summary/single-Approve shape as
 * asset_allocation above. Its AI summary can only be grounded in real provisioning + asset data,
 * which only exists once it_account_creation AND asset_allocation are both verified; under this
 * workflow's strict top-to-bottom step locking that's already guaranteed by the time Notify is
 * even clickable here (a step only unlocks once the one right before it is verified, which itself
 * required the one before THAT to be verified, and so on) — so in practice this always generates
 * the summary immediately. maybeGenerateItVerificationSummary below is kept as a defensive
 * fallback for if that locking ever loosens. */
async function notifyItVerification(
  workflowId: string,
  step: WorkflowStepDetail,
  department: { roleId: string; approverId: string | null },
) {
  const employeeName = employeeDisplayName(workflowId)

  runInTransaction(() => {
    const approval = createApproval({ workflowId, stepId: step.id, approverId: department.approverId, status: 'allocated' })
    createNotification({
      roleId: department.roleId,
      approvalId: approval.id,
      message: `${humanizeStepName(step.stepName)} needed for ${employeeName}`,
    })
  })

  await maybeGenerateItVerificationSummary(workflowId)
}

/** Generates it_verification's AI summary the moment both preconditions (it_account_creation and
 * asset_allocation verified) are true, provided it_verification has already been notified but has
 * no summary yet. Called from notifyItVerification (immediately, since the precondition is
 * already guaranteed there under normal step ordering) and from verifyStep (after verifying any
 * step, in case verifying it_account_creation or asset_allocation is what completes the
 * precondition) — so the card becomes approvable for Diego without HR needing to re-notify it.
 * No-ops safely whenever there's nothing to do: no it_verification approval yet, already
 * summarized, or the precondition still isn't met. */
async function maybeGenerateItVerificationSummary(workflowId: string) {
  const steps = listWorkflowStepDetails(workflowId)
  const itVerificationStep = steps.find((s) => s.stepName === IT_VERIFICATION_STEP_NAME)
  if (!itVerificationStep?.approval || itVerificationStep.approval.status === 'verified') return
  if (getLatestItVerificationSummary(workflowId)) return

  const itAccountStep = steps.find((s) => s.stepName === IT_ACCOUNT_CREATION_STEP_NAME)
  const assetStep = steps.find((s) => s.stepName === ASSET_ALLOCATION_STEP_NAME)
  if (itAccountStep?.approval?.status !== 'verified' || assetStep?.approval?.status !== 'verified') return

  const approval = getLatestApprovalForStep(workflowId, itVerificationStep.id)
  if (!approval) return

  const employeeName = employeeDisplayName(workflowId)
  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  const accountReport = getLatestItAccountReport(workflowId)
  const assetSummary = getLatestAssetAllocationSummary(workflowId)
  const employee = getEmployeeById(getWorkflow(workflowId)!.employeeId)
  const loginEmail = accountReport?.email ?? (employee ? getUserById(employee.userId)?.email : undefined) ?? '—'

  const { summaryText } = await generateItVerificationSummary({
    fullName: submission?.fullName ?? employeeName,
    roleTitle: submission?.roleTitle ?? 'their role',
    department: submission?.department ?? 'their department',
    accountEmail: loginEmail,
    assetSummary: assetSummary?.summaryText ?? 'Standard asset kit assigned.',
  })

  createItVerificationSummary({ workflowId, stepId: itVerificationStep.id, approvalId: approval.id, summaryText })
}

export type AdhocStepInput = {
  title: string
  description?: string | null
  departmentName: 'IT' | 'Finance' | 'Legal'
  insertAfterStepId: string
  subtaskTitles?: string[]
}

export function insertAdhocStep(
  workflowId: string,
  input: AdhocStepInput,
): { ok: true; steps: WorkflowStepDetail[] } | { ok: false; error: WorkflowActionError } {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const anchorExists = getWorkflowSteps(workflowId).some((s) => s.id === input.insertAfterStepId)
  if (!anchorExists) return { ok: false, error: 'invalid_anchor_step' }

  const department = resolveDepartmentApprover(input.departmentName)
  if (!department) return { ok: false, error: 'department_role_missing' }

  const employeeName = employeeDisplayName(workflowId)
  // Ordering among ad-hoc steps only matters relative to siblings anchored at the same step
  // (see getWorkflowSteps' merge logic) — an increasing counter is enough, no renumbering needed.
  const stepOrder = listAdhocStepsForWorkflow(workflowId).length + 1

  runInTransaction(() => {
    const step = createAdhocStep({
      workflowId,
      stepName: input.title,
      departmentName: input.departmentName,
      stepOrder,
      description: input.description ?? null,
      insertAfterStepId: input.insertAfterStepId,
    })
    const approval = createApproval({
      workflowId,
      stepId: step.id,
      approverId: department.approverId,
      status: 'allocated',
    })
    for (const title of input.subtaskTitles ?? []) {
      createSubtask({ approvalId: approval.id, title })
    }
    createNotification({
      roleId: department.roleId,
      approvalId: approval.id,
      message: `${humanizeStepName(step.stepName)} needed for ${employeeName}`,
    })
  })

  return { ok: true, steps: listWorkflowStepDetails(workflowId) }
}

export async function verifyStep(
  workflowId: string,
  stepId: string,
  verifiedByUserId: string,
  comment?: string,
): Promise<{ ok: true; step: WorkflowStepDetail; workflowStatus: string } | { ok: false; error: WorkflowActionError }> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const steps = listWorkflowStepDetails(workflowId)
  const index = steps.findIndex((s) => s.id === stepId)
  if (index === -1) return { ok: false, error: 'step_not_found' }

  const step = steps[index]

  // Steps run strictly top to bottom — this one can't be verified until every earlier step is verified.
  if (step.locked) return { ok: false, error: 'step_locked' }

  const isDeptFixed = DEPARTMENT_FIXED.has(step.departmentName)

  // Every step — department-fixed or HR/Manager-owned — must reach 'completed' first (via
  // Notify + department work, or an employee/HR submission) before HR can verify it. HR-owned
  // steps used to let Verify fire straight from 'pending' with no prior action; that was the bug.
  if (step.approval?.status === 'verified') return { ok: false, error: 'already_verified' }
  if (step.approval?.status !== 'completed') return { ok: false, error: 'not_completed' }

  const existingApproval = getLatestApprovalForStep(workflowId, stepId)
  if (!existingApproval) return { ok: false, error: 'not_completed' }

  const verifiedAt = new Date().toISOString()

  runInTransaction(() => {
    updateApprovalStatus(existingApproval.id, 'verified', { verifiedBy: verifiedByUserId, verifiedAt, comment: comment ?? null })

    // The next step in the ordered list becomes the workflow's new point of focus; if this
    // was the last step, the whole workflow is done.
    const nextStep = steps[index + 1] ?? null
    const isLastStep = index === steps.length - 1
    updateWorkflowCurrentStep(workflowId, nextStep ? nextStep.id : null, isLastStep ? 'completed' : undefined)

    if (isDeptFixed) {
      const department = getRoleByName(step.departmentName)
      if (department) {
        createNotification({
          roleId: department.id,
          approvalId: existingApproval.id,
          message: `${humanizeStepName(step.stepName)} for ${employeeDisplayName(workflowId)} verified by HR`,
        })
      }
    }
  })

  // Verifying it_account_creation or asset_allocation may be exactly what satisfies
  // it_verification's precondition — see maybeGenerateItVerificationSummary's own comment for why
  // this is a defensive no-op under the current strict step ordering (notifyItVerification already
  // covers the normal path), kept for if that ordering ever loosens.
  await maybeGenerateItVerificationSummary(workflowId)

  const updatedWorkflow = getWorkflow(workflowId)!
  return { ok: true, step: getWorkflowStepDetail(workflowId, stepId)!, workflowStatus: updatedWorkflow.status }
}

export type EmployeeDetailsInput = {
  fullName: string
  email: string
  phone: string
  address?: string | null
  roleTitle: string
  department: string
  startDate: string
}

const EMPLOYEE_DETAILS_STEP_NAME = 'employee_details'

/** The employee's own submission for step 1 — completes the step so HR can verify it, same
 * "reach 'completed', then HR verifies" pattern department-fixed steps use via Notify. The
 * employee can keep editing and resubmitting (each resubmission overwrites what HR sees) right
 * up until HR verifies it; once verified, the step is locked in like every other step. */
export function submitEmployeeDetails(
  workflowId: string,
  submittedByUserId: string,
  input: EmployeeDetailsInput,
): { ok: true; step: WorkflowStepDetail } | { ok: false; error: WorkflowActionError } {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const step = listWorkflowStepDetails(workflowId).find((s) => s.stepName === EMPLOYEE_DETAILS_STEP_NAME)
  if (!step) return { ok: false, error: 'step_not_found' }

  const existingApproval = getLatestApprovalForStep(workflowId, step.id)
  if (existingApproval?.status === 'verified') return { ok: false, error: 'already_submitted' }
  const isResubmission = existingApproval?.status === 'completed'

  const submittedAt = new Date().toISOString()

  runInTransaction(() => {
    // A fresh row each time, not an update in place: getEmployeeDetailSubmissionByWorkflow
    // always returns the most recently submitted_at row, so this naturally overwrites what HR sees.
    createEmployeeDetailSubmission({
      workflowId,
      employeeId: workflow.employeeId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      address: input.address ?? null,
      roleTitle: input.roleTitle,
      department: input.department,
      startDate: input.startDate,
      submittedBy: submittedByUserId,
      submittedAt,
    })

    let approvalId: string
    if (existingApproval) {
      updateApprovalStatus(existingApproval.id, 'completed', {})
      approvalId = existingApproval.id
    } else {
      approvalId = createApproval({ workflowId, stepId: step.id, approverId: null, status: 'completed', createdAt: submittedAt }).id
    }

    const hrRole = getRoleByName('HR')
    if (hrRole) {
      createNotification({
        roleId: hrRole.id,
        approvalId,
        message: isResubmission
          ? `${employeeDisplayName(workflowId)} updated their Employee Details submission`
          : `${employeeDisplayName(workflowId)} submitted Employee Details for review`,
      })
    }
  })

  return { ok: true, step: getWorkflowStepDetail(workflowId, step.id)! }
}

// ---------- Step 2: upload_documents ----------

const UPLOAD_DOCUMENTS_STEP_NAME = 'upload_documents'

type SubmissionFieldKey = 'fullName' | 'email' | 'phone' | 'address' | 'roleTitle' | 'department' | 'startDate'

export type DocumentFieldDef = { key: SubmissionFieldKey; label: string }
export type DocumentTypeDef = { type: string; label: string; description: string; fields: DocumentFieldDef[] }

/** The 4 document types an employee can upload — the first 3 deliberately carry a handful of
 * fields that overlap with the step 1 submission, so the AI cross-check in step 3 has something
 * to compare; Photo carries none since there's nothing on it to cross-check against text fields. */
export const REQUIRED_DOCUMENT_TYPES: DocumentTypeDef[] = [
  {
    type: 'government_id',
    label: 'Government ID',
    description: 'A photo ID such as a passport or driver’s license',
    fields: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'address', label: 'Address' },
    ],
  },
  {
    type: 'offer_letter',
    label: 'Offer Letter',
    description: 'The signed offer letter confirming role and start date',
    fields: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'roleTitle', label: 'Role / Title' },
      { key: 'department', label: 'Department' },
      { key: 'startDate', label: 'Start Date' },
    ],
  },
  {
    type: 'address_proof',
    label: 'Proof of Address',
    description: 'A recent utility bill or bank statement showing your address',
    fields: [
      { key: 'fullName', label: 'Full Name' },
      { key: 'address', label: 'Address' },
    ],
  },
  {
    type: 'photo',
    label: 'Photo',
    description: 'A recent photo of yourself',
    fields: [],
  },
]

export type UploadedFile = { fileName: string; mimeType: string; dataBase64: string }

/** The employee's upload of one of the 4 required documents, now a real file (not just typed
 * fields) — uploading the last missing type completes the step so HR can verify it, same "reach
 * 'completed', then HR verifies" pattern as employee_details. Re-uploading a type before
 * verification overwrites what HR/AI see. */
export function uploadEmployeeDocument(
  workflowId: string,
  uploadedByUserId: string,
  documentType: string,
  fields: Record<string, string>,
  file: UploadedFile,
): { ok: true; step: WorkflowStepDetail; uploadedTypes: string[] } | { ok: false; error: WorkflowActionError } {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const step = listWorkflowStepDetails(workflowId).find((s) => s.stepName === UPLOAD_DOCUMENTS_STEP_NAME)
  if (!step) return { ok: false, error: 'step_not_found' }

  const existingApproval = getLatestApprovalForStep(workflowId, step.id)
  if (existingApproval?.status === 'verified') return { ok: false, error: 'already_submitted' }

  const wasAlreadyComplete = existingApproval?.status === 'completed'

  runInTransaction(() => {
    createEmployeeDocument({
      workflowId,
      employeeId: workflow.employeeId,
      documentType,
      fileName: file.fileName,
      fileMimeType: file.mimeType,
      fileData: file.dataBase64,
      extractedFields: fields,
      uploadedBy: uploadedByUserId,
    })

    const uploadedTypes = new Set(listEmployeeDocumentsByWorkflow(workflowId).map((d) => d.documentType))
    const allUploaded = REQUIRED_DOCUMENT_TYPES.every((d) => uploadedTypes.has(d.type))
    if (!allUploaded) return

    let approvalId: string
    if (existingApproval) {
      updateApprovalStatus(existingApproval.id, 'completed', {})
      approvalId = existingApproval.id
    } else {
      approvalId = createApproval({ workflowId, stepId: step.id, approverId: null, status: 'completed' }).id
    }

    const hrRole = getRoleByName('HR')
    if (hrRole) {
      createNotification({
        roleId: hrRole.id,
        approvalId,
        message: wasAlreadyComplete
          ? `${employeeDisplayName(workflowId)} updated an uploaded document`
          : `${employeeDisplayName(workflowId)} uploaded all required documents for review`,
      })
    }
  })

  return {
    ok: true,
    step: getWorkflowStepDetail(workflowId, step.id)!,
    uploadedTypes: listEmployeeDocumentsByWorkflow(workflowId).map((d) => d.documentType),
  }
}

// ---------- Step 3: ai_document_verification ----------

const AI_DOCUMENT_VERIFICATION_STEP_NAME = 'ai_document_verification'

export type AiFieldComparison = {
  field: SubmissionFieldKey
  label: string
  documentType: string
  documentLabel: string
  submittedValue: string
  documentValue: string
  match: boolean
}

export type AiVerificationOutcome = {
  overallStatus: 'match' | 'partial' | 'mismatch'
  summary: string
  details: AiFieldComparison[]
  runAt: string
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function submissionValue(submission: EmployeeDetailSubmission, key: SubmissionFieldKey): string {
  return submission[key] ?? ''
}

function buildAiSummary(details: AiFieldComparison[], employeeName: string): string {
  if (details.length === 0) return `No uploaded documents were available to cross-check for ${employeeName}.`
  const mismatches = details.filter((d) => !d.match)
  if (mismatches.length === 0) {
    return `AI cross-check passed: all ${details.length} field(s) across the uploaded documents match ${employeeName}'s Employee Details.`
  }
  const mismatchText = mismatches
    .map((m) => `${m.label} on ${m.documentLabel} ("${m.documentValue}") vs Employee Details ("${m.submittedValue}")`)
    .join('; ')
  return `AI cross-check found ${mismatches.length} of ${details.length} field(s) not matching: ${mismatchText}.`
}

/** Runs the (mock) AI cross-check of the 3 uploaded documents against the step 1 submission —
 * triggered by HR, not automatic, so HR decides when to run it and reviews the summary before
 * deciding to Verify. Re-running before verification overwrites the stored result. */
export function runAiDocumentVerification(
  workflowId: string,
  runByUserId: string,
): { ok: true; step: WorkflowStepDetail; result: AiVerificationOutcome } | { ok: false; error: WorkflowActionError } {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const step = listWorkflowStepDetails(workflowId).find((s) => s.stepName === AI_DOCUMENT_VERIFICATION_STEP_NAME)
  if (!step) return { ok: false, error: 'step_not_found' }
  if (step.locked) return { ok: false, error: 'step_locked' }

  const existingApproval = getLatestApprovalForStep(workflowId, step.id)
  if (existingApproval?.status === 'verified') return { ok: false, error: 'already_submitted' }

  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  const documents = listEmployeeDocumentsByWorkflow(workflowId)

  const details: AiFieldComparison[] = []
  if (submission) {
    for (const docDef of REQUIRED_DOCUMENT_TYPES) {
      const doc = documents.find((d) => d.documentType === docDef.type)
      if (!doc) continue
      for (const fieldDef of docDef.fields) {
        const submittedValue = submissionValue(submission, fieldDef.key)
        const documentValue = doc.extractedFields[fieldDef.key] ?? ''
        details.push({
          field: fieldDef.key,
          label: fieldDef.label,
          documentType: docDef.type,
          documentLabel: docDef.label,
          submittedValue,
          documentValue,
          match: normalizeForCompare(submittedValue) === normalizeForCompare(documentValue),
        })
      }
    }
  }

  const mismatchCount = details.filter((d) => !d.match).length
  const overallStatus: AiVerificationOutcome['overallStatus'] =
    details.length === 0 || mismatchCount === details.length ? 'mismatch' : mismatchCount === 0 ? 'match' : 'partial'
  const summary = buildAiSummary(details, employeeDisplayName(workflowId))
  const runAt = new Date().toISOString()

  runInTransaction(() => {
    createDocumentVerificationResult({ workflowId, stepId: step.id, overallStatus, summary, details, runBy: runByUserId, runAt })

    let approvalId: string
    if (existingApproval) {
      updateApprovalStatus(existingApproval.id, 'completed', {})
      approvalId = existingApproval.id
    } else {
      approvalId = createApproval({ workflowId, stepId: step.id, approverId: runByUserId, status: 'completed', createdAt: runAt }).id
    }

    const hrRole = getRoleByName('HR')
    if (hrRole) {
      createNotification({
        roleId: hrRole.id,
        approvalId,
        message: `AI document verification ${overallStatus === 'match' ? 'passed' : 'found mismatches'} for ${employeeDisplayName(workflowId)} — ready for review`,
      })
    }
  })

  return { ok: true, step: getWorkflowStepDetail(workflowId, step.id)!, result: { overallStatus, summary, details, runAt } }
}

// ---------- Step 4: hr_approval ----------

const HR_APPROVAL_STEP_NAME = 'hr_approval'

export type HrApprovalProfileEntryOutcome = {
  markdown: string
  summary: string
  documentId: string
  documentName: string
  generatedAt: string
}

/** HR-triggered: compiles the AI-generated Knowledge Base directory profile and saves it right
 * away (same "reach 'completed', then HR verifies" pattern as every other step — e.g.
 * runAiDocumentVerification above). This only completes the step; pushing it to 'verified' (and
 * so unlocking manager_approval / showing "verified" on the employee side) goes through the same
 * generic Verify button/action every other step uses, not a bespoke one-shot approve. Re-running
 * before verification regenerates the preview and saves a new KB doc — the previous one it
 * created isn't retracted, matching the dev-reset step's "don't retract KB docs" behavior. */
export async function generateHrApprovalProfileEntry(
  workflowId: string,
  runByUserId: string,
): Promise<
  { ok: true; step: WorkflowStepDetail; entry: HrApprovalProfileEntryOutcome } | { ok: false; error: WorkflowActionError }
> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const step = listWorkflowStepDetails(workflowId).find((s) => s.stepName === HR_APPROVAL_STEP_NAME)
  if (!step) return { ok: false, error: 'step_not_found' }
  if (step.locked) return { ok: false, error: 'step_locked' }

  const existingApproval = getLatestApprovalForStep(workflowId, step.id)
  if (existingApproval?.status === 'verified') return { ok: false, error: 'already_submitted' }

  const submission = getEmployeeDetailSubmissionByWorkflow(workflowId)
  if (!submission) return { ok: false, error: 'not_completed' }

  const employee = getEmployeeById(workflow.employeeId)
  const manager = employee?.managerId ? getEmployeeById(employee.managerId) : null

  const { markdown, summary, document } = await createEmployeeProfileKbEntry({
    fullName: submission.fullName,
    email: submission.email,
    phone: submission.phone,
    roleTitle: submission.roleTitle,
    department: submission.department,
    startDate: submission.startDate,
    managerName: manager ? `${manager.firstName} ${manager.lastName}` : null,
  })

  const generatedAt = new Date().toISOString()

  runInTransaction(() => {
    createHrApprovalProfileEntry({
      workflowId,
      stepId: step.id,
      markdown,
      summary,
      documentId: document.id,
      documentName: document.originalName,
      generatedBy: runByUserId,
      generatedAt,
    })

    let approvalId: string
    if (existingApproval) {
      updateApprovalStatus(existingApproval.id, 'completed', {})
      approvalId = existingApproval.id
    } else {
      approvalId = createApproval({ workflowId, stepId: step.id, approverId: runByUserId, status: 'completed', createdAt: generatedAt }).id
    }

    const hrRole = getRoleByName('HR')
    if (hrRole) {
      createNotification({
        roleId: hrRole.id,
        approvalId,
        message: `AI-generated directory profile ready for review — ${employeeDisplayName(workflowId)}`,
      })
    }
  })

  return {
    ok: true,
    step: getWorkflowStepDetail(workflowId, step.id)!,
    entry: { markdown, summary, documentId: document.id, documentName: document.originalName, generatedAt },
  }
}

// ---------- Dev-only: reset the last completed step ----------

export type ResetLastStepResult =
  | { ok: true; step: WorkflowStepDetail }
  | { ok: false; error: 'workflow_not_found' | 'nothing_to_reset' }

/** Testing convenience only (see the dev-flag gate in the route). Undoes the single
 * furthest-along verified step — "bottom up" — clearing whatever data backs it, without
 * touching any earlier step. There's never a downstream step to also invalidate: by definition
 * the step being reset is the last one that was ever verified. */
export function resetLastVerifiedStep(workflowId: string): ResetLastStepResult {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  const steps = listWorkflowStepDetails(workflowId)
  let targetIndex = -1
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].approval?.status === 'verified') {
      targetIndex = i
      break
    }
  }
  if (targetIndex === -1) return { ok: false, error: 'nothing_to_reset' }

  const step = steps[targetIndex]

  runInTransaction(() => {
    switch (step.stepName) {
      case 'employee_details':
        deleteEmployeeDetailSubmissionsForWorkflow(workflowId)
        break
      case 'upload_documents':
        deleteEmployeeDocumentsForWorkflow(workflowId)
        break
      case 'ai_document_verification':
        deleteDocumentVerificationResultsForWorkflow(workflowId)
        break
      case 'hr_approval':
        // The generated-profile preview is cleared; any KB doc it already created is left in
        // place (same "don't retract KB docs" behavior noted on generateHrApprovalProfileEntry).
        deleteHrApprovalProfileEntriesForWorkflow(workflowId)
        break
      case 'manager_approval':
        deleteManagerApprovalReportsForWorkflow(workflowId)
        break
      case 'it_account_creation':
        deleteItAccountReportsForWorkflow(workflowId)
        break
      default:
        // Anything else: no separate per-workflow cleanup needed. asset_allocation and
        // it_verification's AI summaries are approval-scoped (not workflow-scoped like the cases
        // above), so deleteApprovalsForStep below already clears them.
        break
    }
    deleteApprovalsForStep(workflowId, step.id)
    updateWorkflowCurrentStep(workflowId, step.id, workflow.status === 'completed' ? 'in_progress' : undefined)
  })

  return { ok: true, step: getWorkflowStepDetail(workflowId, step.id)! }
}

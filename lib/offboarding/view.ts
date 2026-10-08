import { getUserById } from '@/lib/workflow-store'
import type { Caller } from '@/lib/server-auth'
import {
  loadOffboarding,
  approvalOf,
  exitDetailsFor,
  noticePeriodDays,
  resolveManagerUser,
  listManagerCandidates,
} from '@/lib/offboarding/context'
import {
  getLatestDecision,
  getActiveHandoverPlan,
  listOwnershipTransfers,
  listAccessActions,
  listAssetReturnItems,
  getSettlementStatement,
  listWorkflowEvents,
  type Decision,
  type ExitDetails,
} from '@/lib/offboarding/store'
import { describeExitInfoRequest, getLatestExitInfoRequest, getOpenExitInfoRequest, requestableFieldsNow } from '@/lib/offboarding/exit-info-requests'
import { employeeMayProvideExitDetails } from '@/lib/offboarding/exit-detail-fields'
import { completionBlockers } from '@/lib/offboarding/actions'

/** GET /api/workflows/[id]/offboarding — the offboarding-specific state each viewer is allowed to
 * see. HR/Administrator: everything. Manager / IT: what their tasks need. The exiting employee:
 * only their own action items (handover, assets) and whether settlement is processed — never
 * internal finance details. Everyone else: nothing (null → 403). */

function describeDecision(decision: Decision | null) {
  if (!decision) return null
  return {
    decision: decision.decision,
    comment: decision.comment,
    decidedBy: getUserById(decision.decidedBy)?.name ?? 'Unknown user',
    decidedAt: decision.decidedAt,
  }
}

function userName(id: string | null) {
  return id ? (getUserById(id)?.name ?? 'Unknown user') : null
}

/** Exit details plus, per field, where the value came from — for HR's panel. */
function describeExitDetails(details: ExitDetails) {
  const sources = Object.fromEntries(
    Object.entries(details.sources).map(([field, src]) => [field, { source: src!.source, by: userName(src!.by), at: src!.at }]),
  )
  return { ...details, sources, lwdConfirmedBy: userName(details.lwdConfirmedBy) }
}

/** The exit-details audit trail: every field change (who, when, old → new), confirmations, clears. */
function exitDetailHistory(workflowId: string) {
  return listWorkflowEvents(workflowId)
    .filter((e) => e.stepKey === 'exit_details' || e.action.startsWith('exit_details_'))
    .map((e) => ({ action: e.action, detail: e.detail, performedBy: userName(e.performedBy), performedAt: e.performedAt }))
    .reverse()
}

export function getOffboardingState(workflowId: string, caller: Caller) {
  const ctx = loadOffboarding(workflowId)
  if (!ctx) return null
  const role = caller.role.name
  const isEmployee = role === 'Employee' && caller.employee?.id === ctx.employee.id
  const isHr = role === 'HR' || role === 'Administrator'
  if (!isHr && !isEmployee && !['Manager', 'IT', 'Finance', 'Legal'].includes(role)) return null

  const details = exitDetailsFor(ctx)
  const plan = getActiveHandoverPlan(workflowId)
  const assets = listAssetReturnItems(workflowId)
  const settlementApproval = approvalOf(ctx, 'finance_settlement')

  if (isEmployee) {
    const handoverOpen = approvalOf(ctx, 'knowledge_transfer')?.status === 'allocated' && !!plan
    return {
      viewer: 'employee' as const,
      exitDetails: { lastWorkingDay: details.lastWorkingDay },
      // "HR needs a few details to process your exit" — only while a request is open, and never for
      // a termination (HR fills those). Only the field keys: the form shows just what's missing.
      exitDetailsRequest: (() => {
        const open = getOpenExitInfoRequest(workflowId)
        if (!open || !employeeMayProvideExitDetails(details.exitType)) return null
        const d = describeExitInfoRequest(open)
        return { id: d.id, fields: d.fields, message: d.message, requestedBy: d.requestedBy, requestedAt: d.requestedAt }
      })(),
      handover: handoverOpen
        ? {
            draftNotes: plan!.draftNotes,
            employeeNotes: plan!.employeeNotes,
            confirmedAt: plan!.employeeConfirmedAt,
            items: plan!.items.map((i) => ({ label: i.itemLabel, newOwner: i.newOwner })),
          }
        : null,
      assets: approvalOf(ctx, 'asset_recovery') ? assets.map((a) => ({ name: a.assetName, serial: a.serialNumber, status: a.status })) : [],
      // Status only — amounts and deductions stay internal to Finance.
      settlement:
        settlementApproval?.status === 'completed' || settlementApproval?.status === 'verified'
          ? { processed: true, processedAt: settlementApproval.completedAt }
          : { processed: false, processedAt: null },
    }
  }

  const manager = resolveManagerUser(ctx)
  // A Manager only sees the offboarding of someone who reports to them.
  if (role === 'Manager' && manager?.id !== caller.user.id) return null
  const base = {
    viewer: (isHr ? 'hr' : role.toLowerCase()) as 'hr' | 'manager' | 'it' | 'finance' | 'legal',
    employee: { name: ctx.name, department: ctx.department },
    exitDetails: { ...details, noticePeriodDays: noticePeriodDays(ctx, details) },
    manager: manager ? { id: manager.id, name: manager.name } : null,
    managerDecision: describeDecision(getLatestDecision(workflowId, 'manager_exit_approval')),
  }

  if (role === 'Finance' || role === 'Legal') return base

  const handover = plan
    ? {
        draftNotes: plan.draftNotes,
        employeeNotes: plan.employeeNotes,
        employeeConfirmedAt: plan.employeeConfirmedAt,
        managerAcceptedAt: plan.managerAcceptedAt,
        model: plan.model,
        items: plan.items.map((i) => ({ type: i.itemType, ref: i.itemRef, label: i.itemLabel, currentOwner: i.currentOwner, newOwner: i.newOwner })),
      }
    : null
  const transfers = listOwnershipTransfers(workflowId).map((t) => ({
    label: t.itemLabel,
    ref: t.itemRef,
    oldOwner: t.oldOwner,
    newOwner: t.newOwner,
    transferredBy: getUserById(t.transferredBy)?.name ?? 'Unknown user',
    transferredAt: t.transferredAt,
    revertedAt: t.revertedAt,
  }))
  const assetItems = assets.map((a) => ({ id: a.id, name: a.assetName, type: a.assetType, serial: a.serialNumber, status: a.status, notes: a.conditionNotes, markedAt: a.markedAt }))

  if (role === 'Manager') return { ...base, handover, transfers }
  if (role === 'IT') return { ...base, assets: assetItems }

  const statement = getSettlementStatement(workflowId)
  return {
    ...base,
    managerCandidates: listManagerCandidates().map((u) => ({ id: u.id, name: u.name })),
    exitDetails: { ...describeExitDetails(details), noticePeriodDays: noticePeriodDays(ctx, details) },
    exitDetailsRequest: (() => {
      const latest = getLatestExitInfoRequest(workflowId)
      return latest ? describeExitInfoRequest(latest) : null
    })(),
    requestableExitFields: requestableFieldsNow(ctx),
    exitDetailHistory: exitDetailHistory(workflowId),
    hrDecision: describeDecision(getLatestDecision(workflowId, 'hr_exit_approval')),
    handover,
    transfers,
    assets: assetItems,
    accessActions: listAccessActions(workflowId).map((a) => ({
      system: a.system,
      description: a.description,
      action: a.action,
      status: a.status,
      effectiveDate: a.effectiveDate,
      createdAt: a.createdAt,
      revertedAt: a.revertedAt,
    })),
    settlement: statement ? { updatedAt: statement.updatedAt } : null,
    completion: { blockers: completionBlockers(workflowId), completed: ctx.workflow.status === 'completed' },
  }
}

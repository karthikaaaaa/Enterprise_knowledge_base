import { getWorkflow, getEmployeeById, getUserById, setUserActive, getRoleByName, createNotification } from '@/lib/workflow-store'
import { setDocumentOwner } from '@/lib/document-store'
import { humanizeStepName } from '@/lib/workflow-format'
import {
  revertDecisions,
  archiveHandoverPlans,
  listOwnershipTransfers,
  markTransfersReverted,
  listAccessActions,
  revertAccessAction,
  restoreKbGrantsRevokedBy,
  listAssetReturnItems,
  setAssetStatus,
  archiveAssetReturnItems,
  restoreFinanceRecordsEndedBy,
  voidSettlementStatement,
  recordWorkflowEvent,
  clearExitDetails,
  withdrawOpenExitDetailRequests,
} from '@/lib/offboarding/store'
import { directoryService } from '@/lib/offboarding/directory-service'

/**
 * Undo for each offboarding step's soft changes — called by revertStep (lib/workflow-revert.ts)
 * for every step in the revert cascade. Nothing is hard-deleted: decisions / plans / return lines /
 * statements are archived or voided, access actions are marked reverted and their effects restored.
 */

const OFFBOARDING_STEP_KEYS = new Set([
  'exit_initiated',
  'manager_exit_approval',
  'hr_exit_approval',
  'knowledge_transfer',
  'it_access_deactivation',
  'asset_recovery',
  'finance_settlement',
  'legal_clearance',
  'exit_completed',
])

export function isOffboardingStepKey(stepKey: string) {
  return OFFBOARDING_STEP_KEYS.has(stepKey)
}

/** Work outside sqlite (documents.json) — runs before the revert transaction, like the onboarding
 * KB-document retraction does. */
export async function undoOffboardingStepOutsideDb(workflowId: string, stepKey: string) {
  if (stepKey !== 'knowledge_transfer') return
  for (const transfer of listOwnershipTransfers(workflowId, false)) {
    if (transfer.itemType === 'kb_document') await setDocumentOwner(transfer.itemRef, transfer.oldOwner)
  }
}

/** sqlite-side undo — runs inside the revert transaction. */
export function undoOffboardingStep(workflowId: string, stepKey: string, performedBy: string) {
  switch (stepKey) {
    case 'exit_initiated':
      // Back to before the exit was initiated: the exit details go (their values are kept in the
      // audit event) and any open "HR needs a few details" request is withdrawn. With no Exit
      // Initiated approval the offboarding no longer counts, so the employee is Active again
      // (lib/offboarding/access.ts). Every later step's undo runs in the same cascade.
      clearExitDetails(workflowId, performedBy)
      withdrawOpenExitDetailRequests(workflowId)
      break
    case 'manager_exit_approval':
    case 'hr_exit_approval':
      revertDecisions(workflowId, stepKey)
      break
    case 'knowledge_transfer':
      revertDecisions(workflowId, stepKey)
      markTransfersReverted(workflowId)
      archiveHandoverPlans(workflowId)
      break
    case 'it_access_deactivation':
      for (const action of listAccessActions(workflowId, true)) {
        if (!['kb_grant', 'kb_department_visibility', 'sso', 'email', 'app_login'].includes(action.system)) continue
        if ((action.system === 'sso' || action.system === 'email') && action.externalRef) directoryService().cancel(action.externalRef)
        revertAccessAction(action.id)
      }
      restoreKbGrantsRevokedBy(workflowId)
      break
    case 'asset_recovery':
      for (const item of listAssetReturnItems(workflowId)) {
        if (item.status !== 'pending') setAssetStatus(item.assetId, item.priorStatus)
      }
      archiveAssetReturnItems(workflowId)
      break
    case 'finance_settlement':
      restoreFinanceRecordsEndedBy(workflowId)
      for (const action of listAccessActions(workflowId, true)) {
        if (action.system === 'payroll' || action.system === 'expense') revertAccessAction(action.id)
      }
      voidSettlementStatement(workflowId)
      break
    case 'exit_completed': {
      const workflow = getWorkflow(workflowId)
      const employee = workflow ? getEmployeeById(workflow.employeeId) : null
      if (employee) setUserActive(employee.userId, true)
      for (const action of listAccessActions(workflowId, true)) {
        if (action.system === 'app_login_final') revertAccessAction(action.id)
        // Still-scheduled SSO/email deactivations go back to "scheduled" — unless IT access was
        // reverted in the same cascade, in which case those actions are already reverted.
        if ((action.system === 'sso' || action.system === 'email') && action.externalRef) directoryService().reschedule(action.externalRef)
      }
      break
    }
    default:
      break
  }
  recordWorkflowEvent({ workflowId, stepKey, action: 'reverted', detail: {}, performedBy })
}

/** After a revert commits: tell everyone whose step was undone. The reporting manager and the
 * exiting employee are told directly (per-user notifications), not via their whole role. Reverting
 * Exit Initiated also tells the employee they're Active again, and the departments that still had a
 * task waiting (`pendingOwnerRoles`) that it's gone. */
export function notifyOffboardingRevert(
  workflowId: string,
  stepKeys: string[],
  ownerRoles: string[],
  reason: string | null,
  pendingOwnerRoles: string[] = [],
) {
  const workflow = getWorkflow(workflowId)
  const employee = workflow ? getEmployeeById(workflow.employeeId) : null
  const name = employee ? `${employee.firstName} ${employee.lastName}` : 'an employee'
  const why = reason ? ` — ${reason}` : ''
  const exitReverted = stepKeys[0] === 'exit_initiated'
  const message = exitReverted
    ? `Offboarding for ${name} was reverted to before the exit was initiated (${stepKeys.map(humanizeStepName).join(', ')})${why}. ${name} is Active again.`
    : `Offboarding for ${name} reverted: ${stepKeys.map(humanizeStepName).join(', ')}${why}`

  const roles = new Set(['HR', ...ownerRoles, ...pendingOwnerRoles])
  const managerEmployee = employee?.managerId ? getEmployeeById(employee.managerId) : null
  const managerUser = managerEmployee ? getUserById(managerEmployee.userId) : null
  for (const roleName of roles) {
    const role = getRoleByName(roleName)
    if (!role) continue
    if (roleName === 'Manager') {
      // Only their own manager — never every manager.
      if (managerUser) createNotification({ roleId: role.id, recipientUserId: managerUser.id, message })
      continue
    }
    createNotification({ roleId: role.id, message: pendingOwnerRoles.includes(roleName) && exitReverted ? `${message} Your pending offboarding task for ${name} has been removed.` : message })
  }
  if (exitReverted && employee) {
    const employeeRole = getRoleByName('Employee')
    if (employeeRole) {
      createNotification({
        roleId: employeeRole.id,
        recipientUserId: employee.userId,
        message: `Your offboarding has been reverted${why}. Your account is active again and no exit is in progress.`,
      })
    }
  }
}

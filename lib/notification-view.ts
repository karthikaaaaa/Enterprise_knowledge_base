import { listNotificationsByRole, getApproval, getWorkflow, getEmployeeById, type Notification } from '@/lib/workflow-store'

export type NotificationItem = {
  id: string
  message: string
  isRead: boolean
  createdAt: string
  approvalId: string | null
  workflowId: string | null
  workflowType: string | null
  stepId: string | null
  employeeName: string | null
}

const LIST_LIMIT = 20

function describeNotification(notification: Notification): NotificationItem {
  let workflowId: string | null = null
  let workflowType: string | null = null
  let stepId: string | null = null
  let employeeName: string | null = null

  const approval = notification.approvalId ? getApproval(notification.approvalId) : null
  if (approval) {
    workflowId = approval.workflowId
    stepId = approval.stepId
    const workflow = getWorkflow(approval.workflowId)
    if (workflow) {
      workflowType = workflow.type
      const employee = getEmployeeById(workflow.employeeId)
      if (employee) employeeName = `${employee.firstName} ${employee.lastName}`
    }
  }

  return {
    id: notification.id,
    message: notification.message,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
    approvalId: notification.approvalId,
    workflowId,
    workflowType,
    stepId,
    employeeName,
  }
}

/** Most recent notifications for a role — notifications are role-scoped (role_id FK from Step 1), not per-user, so every login sharing a role sees the same list — plus any addressed to this user only (recipient_user_id). */
export function listNotificationsForRole(roleId: string, userId: string | null = null): NotificationItem[] {
  return listNotificationsByRole(roleId, userId).slice(0, LIST_LIMIT).map(describeNotification)
}

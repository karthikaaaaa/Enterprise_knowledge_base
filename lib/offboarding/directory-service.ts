import { createDirectoryTicket, getDirectoryTicket, setDirectoryTicketStatus, type DirectoryTicket } from '@/lib/offboarding/store'

/**
 * The boundary to external identity systems (SSO, email). Offboarding only ever talks to this
 * interface, so a real IdP / mail-admin integration replaces MockDirectoryService without touching
 * the steps. The mock records tickets in workflows.db (directory_tickets) so every action is
 * visible, idempotent and reversible.
 */
export type DirectorySystem = 'sso' | 'email'

export interface DirectoryService {
  /** Schedule an account's deactivation for `effectiveDate`. Returns the external ticket id. */
  scheduleDeactivation(system: DirectorySystem, account: string, effectiveDate: string | null): DirectoryTicket
  /** Undo a scheduled (or completed) deactivation — used by Revert. */
  cancel(ticketId: string): void
  /** Carry out a scheduled deactivation now — used at Exit Completed. */
  complete(ticketId: string): void
  /** Re-open a completed/cancelled ticket as scheduled — used when Exit Completed is reverted. */
  reschedule(ticketId: string): void
  get(ticketId: string): DirectoryTicket | null
}

export const mockDirectoryService: DirectoryService = {
  scheduleDeactivation: (system, account, effectiveDate) => createDirectoryTicket({ system, account, action: 'deactivate', effectiveDate }),
  cancel: (ticketId) => setDirectoryTicketStatus(ticketId, 'cancelled'),
  complete: (ticketId) => setDirectoryTicketStatus(ticketId, 'completed'),
  reschedule: (ticketId) => setDirectoryTicketStatus(ticketId, 'scheduled'),
  get: (ticketId) => getDirectoryTicket(ticketId),
}

let current: DirectoryService = mockDirectoryService

export function directoryService(): DirectoryService {
  return current
}

/** Tests / a future real integration swap the implementation here. */
export function setDirectoryService(service: DirectoryService) {
  current = service
}

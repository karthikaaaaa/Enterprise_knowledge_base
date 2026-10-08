/**
 * What HR can ask an employee for when Finance sends a review back with missing data. Client-safe
 * (no server imports) — the HR request form, the employee's form, and the server-side validation
 * all read this one catalogue.
 *
 * Only data this onboarding flow has nowhere else to collect lives here. Missing items that belong
 * to an earlier step (legal name, start date, offer letter, contact email, ...) are fixed by
 * reverting that step so the employee resubmits it — they aren't requestable.
 */

export type InfoRequestFieldKey = 'accountHolder' | 'bankAccountNumber' | 'bankRoutingCode' | 'taxId'

export type InfoRequestField = {
  key: InfoRequestFieldKey
  label: string
  placeholder: string
  /** Masked (last 4 only) everywhere it's displayed — see maskSensitive. */
  sensitive: boolean
  pattern: RegExp
  patternHint: string
}

export type InfoRequestItemKey = 'bank_details' | 'tax_id'

export type InfoRequestItem = {
  key: InfoRequestItemKey
  label: string
  /** The finance log's missingData entry this item resolves. */
  missingDataLabel: string
  fields: InfoRequestField[]
}

export const INFO_REQUEST_ITEMS: Record<InfoRequestItemKey, InfoRequestItem> = {
  bank_details: {
    key: 'bank_details',
    label: 'Bank account details',
    missingDataLabel: 'Bank account details',
    fields: [
      {
        key: 'accountHolder',
        label: 'Account holder name',
        placeholder: 'As it appears on the account',
        sensitive: false,
        pattern: /^[\p{L}][\p{L} .'-]{1,99}$/u,
        patternHint: 'Letters, spaces, apostrophes and hyphens only',
      },
      {
        key: 'bankAccountNumber',
        label: 'Bank account number / IBAN',
        placeholder: 'e.g. 12345678 or GB29NWBK60161331926819',
        sensitive: true,
        pattern: /^[A-Za-z0-9][A-Za-z0-9 -]{3,40}$/,
        patternHint: '4–40 letters, digits, spaces or hyphens',
      },
      {
        key: 'bankRoutingCode',
        label: 'Bank / routing code',
        placeholder: 'e.g. sort code, routing number, IFSC, SWIFT',
        sensitive: false,
        pattern: /^[A-Za-z0-9][A-Za-z0-9 -]{2,20}$/,
        patternHint: '3–20 letters, digits, spaces or hyphens',
      },
    ],
  },
  tax_id: {
    key: 'tax_id',
    label: 'Tax ID',
    missingDataLabel: 'Tax ID',
    fields: [
      {
        key: 'taxId',
        label: 'Tax ID',
        placeholder: 'e.g. national insurance number, TIN, PAN',
        sensitive: true,
        pattern: /^[A-Za-z0-9][A-Za-z0-9 -]{3,20}$/,
        patternHint: '4–20 letters, digits, spaces or hyphens',
      },
    ],
  },
}

export const INFO_REQUEST_ITEM_KEYS = Object.keys(INFO_REQUEST_ITEMS) as InfoRequestItemKey[]

export function isInfoRequestItemKey(value: unknown): value is InfoRequestItemKey {
  return typeof value === 'string' && value in INFO_REQUEST_ITEMS
}

/** Which requestable items a finance run's missingData list calls for (used to pre-fill HR's form). */
export function requestableItemsFromMissing(missingData: string[]): InfoRequestItemKey[] {
  return INFO_REQUEST_ITEM_KEYS.filter((key) => missingData.includes(INFO_REQUEST_ITEMS[key].missingDataLabel))
}

/** Whether HR can ask the employee for data off a finance run: the run flags something the
 * employee can provide, or Finance sent it back. Never once Finance has verified it. Shared by the
 * server check (requestEmployeeInfo) and HR's button, so they can't disagree. */
export function canRequestFromRun(run: { missingData: string[]; reviewAction: 'verified' | 'sent_back' | null }): boolean {
  if (run.reviewAction === 'verified') return false
  return run.reviewAction === 'sent_back' || requestableItemsFromMissing(run.missingData).length > 0
}

/** "••••1234" — never shows more than the last 4 characters. */
export function maskSensitive(value: string): string {
  const compact = value.replace(/[\s-]/g, '')
  return compact.length > 4 ? `••••${compact.slice(-4)}` : '••••'
}

export const INFO_REQUEST_MAX_FILE_BYTES = 8 * 1024 * 1024

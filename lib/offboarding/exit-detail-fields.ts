/**
 * The exit details an offboarding collects, and who may fill which. Client-safe (no server
 * imports) — HR's "Edit exit details" form, the exiting employee's "HR needs a few details" form,
 * and the server-side validation all read this one catalogue, like lib/info-request-items.ts does
 * for onboarding's bank/tax request.
 *
 *   - Exit type is HR-only, always.
 *   - Resignation (or not yet recorded): the employee can be asked for any of the four fields below.
 *   - Termination: the employee gets no form at all — HR fills everything.
 */

export type ExitDetailFieldKey = 'reason' | 'lastWorkingDay' | 'noticeStartDate' | 'forwardingContact'

export type ExitDetailField = {
  key: ExitDetailFieldKey
  /** HR's label. */
  label: string
  /** The employee's label (their own words for it). */
  employeeLabel: string
  /** The hr_exit_approval pre-check's missingData entry this field resolves. */
  missingDataLabel: string
  input: 'text' | 'textarea' | 'date'
  placeholder: string
  validate: (value: string) => string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/

export function isIsoDate(value: string) {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
}

function dateField(value: string) {
  return isIsoDate(value) ? null : 'Enter a valid date (YYYY-MM-DD)'
}

export const EXIT_DETAIL_FIELDS: Record<ExitDetailFieldKey, ExitDetailField> = {
  reason: {
    key: 'reason',
    label: 'Reason',
    employeeLabel: 'Reason for leaving',
    missingDataLabel: 'Reason for leaving',
    input: 'textarea',
    placeholder: 'e.g. Relocating abroad, new role elsewhere',
    validate: (v) => (v.length < 3 ? 'Give a short reason (at least 3 characters)' : v.length > 1000 ? 'Keep the reason under 1000 characters' : null),
  },
  lastWorkingDay: {
    key: 'lastWorkingDay',
    label: 'Last working day',
    employeeLabel: 'Proposed last working day',
    missingDataLabel: 'Last working day',
    input: 'date',
    placeholder: '',
    validate: dateField,
  },
  noticeStartDate: {
    key: 'noticeStartDate',
    label: 'Notice start date',
    employeeLabel: 'Notice start date (the day you handed in your resignation)',
    missingDataLabel: 'Notice start date',
    input: 'date',
    placeholder: '',
    validate: dateField,
  },
  forwardingContact: {
    key: 'forwardingContact',
    label: 'Forwarding contact',
    employeeLabel: 'Forwarding contact (personal email or phone)',
    missingDataLabel: 'Forwarding contact',
    input: 'text',
    placeholder: 'e.g. name@personal.com or +44 7700 900123',
    validate: (v) => (EMAIL.test(v) || PHONE.test(v) ? null : 'Enter a personal email address or phone number'),
  },
}

export const EXIT_DETAIL_FIELD_KEYS = Object.keys(EXIT_DETAIL_FIELDS) as ExitDetailFieldKey[]

/** missingData label for the HR-only exit type. */
export const EXIT_TYPE_MISSING_LABEL = 'Exit type'

export type ExitTypeValue = 'resignation' | 'termination' | 'not_recorded'

export function isExitDetailFieldKey(value: unknown): value is ExitDetailFieldKey {
  return typeof value === 'string' && value in EXIT_DETAIL_FIELDS
}

/** Terminations never get the employee form; resignations (and a not-yet-recorded type) do. */
export function employeeMayProvideExitDetails(exitType: ExitTypeValue) {
  return exitType !== 'termination'
}

/** Which fields a pre-check run's missingData asks the employee for — empty for a termination.
 * Shared by HR's button and the server check, so they can't disagree. */
export function requestableExitFields(missingData: string[], exitType: ExitTypeValue): ExitDetailFieldKey[] {
  if (!employeeMayProvideExitDetails(exitType)) return []
  return EXIT_DETAIL_FIELD_KEYS.filter((key) => missingData.includes(EXIT_DETAIL_FIELDS[key].missingDataLabel))
}

/** Field-level + cross-field validation. `merged` is the record as it would be after the change, so
 * "notice start after last working day" is caught whichever of the two is being edited. */
export function validateExitDetailValues(
  values: Partial<Record<ExitDetailFieldKey, string>>,
  merged: { lastWorkingDay: string | null; noticeStartDate: string | null },
): string | null {
  for (const key of EXIT_DETAIL_FIELD_KEYS) {
    const value = values[key]
    if (value === undefined) continue
    const problem = EXIT_DETAIL_FIELDS[key].validate(value)
    if (problem) return `${EXIT_DETAIL_FIELDS[key].label}: ${problem}`
  }
  if (merged.lastWorkingDay && merged.noticeStartDate && merged.noticeStartDate > merged.lastWorkingDay) {
    return 'The notice start date must be on or before the last working day'
  }
  return null
}

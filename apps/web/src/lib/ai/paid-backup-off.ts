// DB-free helpers for the Kairos "Paid backup" switch, so callers (and tests
// that mock the router module) can recognise the decline without importing
// the error class itself.

export const PAID_BACKUP_OFF_NOTE = 'paid backup off'
export const PAID_BACKUP_OFF_ERROR_NAME = 'PaidBackupOffError'

export function isPaidBackupOffError(err: unknown): boolean {
  return err instanceof Error && err.name === PAID_BACKUP_OFF_ERROR_NAME
}

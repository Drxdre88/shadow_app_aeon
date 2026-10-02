import { isPaidBackupEnabled, PAID_BACKUP_OFF_NOTE } from './paid-backup'
import { writeCronSuccessTrace } from './cron-trace'

/**
 * Fallback-cron gate: true (plus a "skipped · paid backup off" trace for the
 * day) when the user switched the paid backup off, so the cron skips them
 * before building any prompt. The model choke point (getModelForUser) still
 * declines on its own for every other caller.
 */
export async function skipCronIfPaidBackupOff(userId: string, cronName: string): Promise<boolean> {
  if (await isPaidBackupEnabled(userId)) return false
  await writeCronSuccessTrace(userId, { cronName, outcome: 'skipped', skipReason: PAID_BACKUP_OFF_NOTE })
  return true
}

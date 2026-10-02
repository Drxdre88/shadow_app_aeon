import { getPaidBackupSetting } from '@/lib/data/kairos-paid-backup'

export { PAID_BACKUP_OFF_NOTE, isPaidBackupOffError } from '@/lib/ai/paid-backup-off'

/**
 * Whether Kairos may spend the user's own API key (BYOK) when the Max-plan
 * routine misses a job. Default true. When false, every Kairos paid call
 * declines exactly like "no key" (enforced in lib/ai/router getModelForUser)
 * and the deterministic path (skip, expire, plain-text daily message) takes over.
 */
export async function isPaidBackupEnabled(userId: string): Promise<boolean> {
  return getPaidBackupSetting(userId)
}

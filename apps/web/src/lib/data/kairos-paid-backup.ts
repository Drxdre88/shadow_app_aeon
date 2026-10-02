import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

// Kairos "Paid backup" switch. Lives as a server-owned key inside the existing
// user_preferences.preferences jsonb (no schema change). The theme-sync write
// path (upsertPreferences) strips and preserves this key, so a client theme
// save can neither set nor wipe it — only setPaidBackupSetting writes it.
export const PAID_BACKUP_PREF_KEY = 'kairosPaidBackup'

/** Default ON: an unset key keeps the historical behaviour (backup pays). */
export const PAID_BACKUP_DEFAULT = true

export async function getPaidBackupSetting(userId: string): Promise<boolean> {
  const row = await db
    .select({ preferences: userPreferences.preferences })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  const value = (row?.preferences as Record<string, unknown> | undefined)?.[PAID_BACKUP_PREF_KEY]
  return typeof value === 'boolean' ? value : PAID_BACKUP_DEFAULT
}

export async function setPaidBackupSetting(userId: string, enabled: boolean): Promise<boolean> {
  await db
    .insert(userPreferences)
    .values({ userId, preferences: { [PAID_BACKUP_PREF_KEY]: enabled }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        preferences: sql`${userPreferences.preferences} || jsonb_build_object(${PAID_BACKUP_PREF_KEY}::text, ${enabled}::boolean)`,
        updatedAt: new Date(),
      },
    })
  return enabled
}

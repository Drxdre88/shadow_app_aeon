import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { DEFAULT_PREFERENCES } from '@/config/defaults'
import { PAID_BACKUP_PREF_KEY } from './kairos-paid-backup'

export async function findPreferences(userId: string) {
  const row = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])

  return { ...DEFAULT_PREFERENCES, ...(row?.preferences as Record<string, unknown> ?? {}) }
}

// Whether the user has a stored preferences row at all — distinguishes a
// seeded account (e.g. business_admin template stamped at signup) from a
// legacy pre-DB account, since findPreferences always merges defaults in.
export async function hasPreferencesRow(userId: string) {
  const row = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return !!row
}

// Theme/UI sync replaces the whole blob from client state. Server-owned keys
// (the Kairos paid-backup switch) are stripped from the client payload and the
// stored value is carried over, so a theme save can't set or wipe them.
export async function upsertPreferences(userId: string, prefs: Record<string, unknown>) {
  const { [PAID_BACKUP_PREF_KEY]: _ignored, ...clientPrefs } = prefs
  await db
    .insert(userPreferences)
    .values({ userId, preferences: clientPrefs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        preferences: sql`${JSON.stringify(clientPrefs)}::jsonb || jsonb_strip_nulls(jsonb_build_object(${PAID_BACKUP_PREF_KEY}::text, ${userPreferences.preferences} -> ${PAID_BACKUP_PREF_KEY}::text))`,
        updatedAt: new Date(),
      },
    })
}

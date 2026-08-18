import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { DEFAULT_PREFERENCES } from '@/config/defaults'

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

export async function upsertPreferences(userId: string, prefs: Record<string, unknown>) {
  await db
    .insert(userPreferences)
    .values({ userId, preferences: prefs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { preferences: prefs, updatedAt: new Date() },
    })
}

import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { DEFAULT_PREFERENCES } from '@/config/defaults'
import { PAID_BACKUP_PREF_KEY } from './kairos-paid-backup'
import { KAIROS_PROMISES_PREF_KEY } from './kairos-promises'
import { KAIROS_STAGE_PREF_KEY } from './kairos-stage'
import { KAIROS_SURPRISE_PREF_KEY } from './kairos-surprise'
import { KAIROS_IDEA_ATLAS_PREF_KEY, KAIROS_IDEA_SHELF_PREF_KEY } from '@/lib/kairos/ideas/pref-keys'
import { KAIROS_GATE_PREF_KEY, KAIROS_OWNER_MODEL_PREF_KEY, KAIROS_RAPPORT_PREF_KEY } from '@/lib/kairos/moment/pref-keys'

export async function findPreferences(userId: string) {
  const row = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])

  const stored = stripServerOwnedForClient((row?.preferences as Record<string, unknown> ?? {}))
  return { ...DEFAULT_PREFERENCES, ...stored }
}

function stripServerOwnedForClient(prefs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...prefs }
  for (const key of SERVER_OWNED_OBJECT_KEYS) delete out[key]
  return out
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
// (the Kairos paid-backup switch, Kairos promises, predictions, agenda, stage,
// surprise, idea atlas and idea shelf) are stripped from the client payload
// and the stored value is carried over, so a theme save can't set or wipe them.
export const KAIROS_PREDICTIONS_PREF_KEY = 'kairosPredictions'
export const KAIROS_AGENDA_PREF_KEY = 'kairosAgenda'
const SERVER_OWNED_OBJECT_KEYS = [
  KAIROS_PROMISES_PREF_KEY,
  KAIROS_PREDICTIONS_PREF_KEY,
  KAIROS_AGENDA_PREF_KEY,
  KAIROS_STAGE_PREF_KEY,
  KAIROS_SURPRISE_PREF_KEY,
  KAIROS_IDEA_ATLAS_PREF_KEY,
  KAIROS_IDEA_SHELF_PREF_KEY,
  KAIROS_GATE_PREF_KEY,
  KAIROS_OWNER_MODEL_PREF_KEY,
  KAIROS_RAPPORT_PREF_KEY,
] as const

function stripServerOwned(prefs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...prefs }
  delete out[PAID_BACKUP_PREF_KEY]
  for (const key of SERVER_OWNED_OBJECT_KEYS) delete out[key]
  return out
}

export async function upsertPreferences(userId: string, prefs: Record<string, unknown>) {
  const clientPrefs = stripServerOwned(prefs)
  const carried = sql.join(
    SERVER_OWNED_OBJECT_KEYS.map((key) => sql`(case when ${userPreferences.preferences} ? ${key}::text then jsonb_build_object(${key}::text, ${userPreferences.preferences} -> ${key}::text) else '{}'::jsonb end)`),
    sql` || `,
  )
  await db
    .insert(userPreferences)
    .values({ userId, preferences: clientPrefs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        preferences: sql`${JSON.stringify(clientPrefs)}::jsonb || jsonb_strip_nulls(jsonb_build_object(${PAID_BACKUP_PREF_KEY}::text, ${userPreferences.preferences} -> ${PAID_BACKUP_PREF_KEY}::text)) || ${carried}`,
        updatedAt: new Date(),
      },
    })
}

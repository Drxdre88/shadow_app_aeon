'use server'

import { requireAuth } from './helpers'
import { preferencesSchema } from '@/lib/data/validators'
import { findPreferences, upsertPreferences, hasPreferencesRow } from '@/lib/data/preferences'

export async function getPreferences() {
  const userId = await requireAuth()
  return findPreferences(userId)
}

// prefs + whether a DB row exists — the client uses `seeded` to decide if the
// legacy localStorage migration may run (it must not override a stamped row).
export async function getPreferencesWithMeta() {
  const userId = await requireAuth()
  const [prefs, seeded] = await Promise.all([findPreferences(userId), hasPreferencesRow(userId)])
  return { prefs, seeded }
}

export async function savePreferences(data: Record<string, unknown>) {
  const userId = await requireAuth()
  const parsed = preferencesSchema.parse(data)
  await upsertPreferences(userId, parsed)
}

'use server'

import { requireAuth } from './helpers'
import { preferencesSchema } from '@/lib/data/validators'
import { findPreferences, upsertPreferences } from '@/lib/data/preferences'

export async function getPreferences() {
  const userId = await requireAuth()
  return findPreferences(userId)
}

export async function savePreferences(data: Record<string, unknown>) {
  const userId = await requireAuth()
  const parsed = preferencesSchema.parse(data)
  await upsertPreferences(userId, parsed)
}

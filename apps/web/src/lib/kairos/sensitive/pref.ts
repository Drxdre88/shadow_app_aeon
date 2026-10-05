import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

// Sensitive-topic gate switch: opt-in, default OFF, one boolean inside the
// user_preferences jsonb (no schema change). Only setSensitiveGate writes it.
export const SENSITIVE_GATE_PREF_KEY = 'kairosSensitiveGate'
export const SENSITIVE_GATE_DEFAULT = false

export async function getSensitiveGate(userId: string): Promise<boolean> {
  const row = await db
    .select({ preferences: userPreferences.preferences })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  const value = (row?.preferences as Record<string, unknown> | undefined)?.[SENSITIVE_GATE_PREF_KEY]
  return typeof value === 'boolean' ? value : SENSITIVE_GATE_DEFAULT
}

export async function setSensitiveGate(userId: string, enabled: boolean): Promise<boolean> {
  await db
    .insert(userPreferences)
    .values({ userId, preferences: { [SENSITIVE_GATE_PREF_KEY]: enabled }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        preferences: sql`${userPreferences.preferences} || jsonb_build_object(${SENSITIVE_GATE_PREF_KEY}::text, ${enabled}::boolean)`,
        updatedAt: new Date(),
      },
    })
  return enabled
}

import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { SENSITIVE_GATE_DEFAULT, SENSITIVE_GATE_PREF_KEY } from '@/lib/kairos/sensitive/pref-keys'

// The private-topic gate preference: the single reader/writer of
// kairosSensitiveGate inside user_preferences (no schema change).

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

import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_VERDICT_DECK_PREF_KEY } from '@/lib/kairos/verdict-deck/pref-keys'
import { verdictDeckSchema, type VerdictDeck } from '@/lib/kairos/verdict-deck/types'

// The latest Sunday verdict deck's number → item mapping, stored as the
// server-owned `kairosVerdictDeck` key inside user_preferences.preferences (no
// schema change). Written once by the 06:00 run after Telegram delivered it;
// read by the webhook when the owner replies. A newer deck replaces it.

const deckValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_VERDICT_DECK_PREF_KEY}::text`

export async function readVerdictDeck(userId: string): Promise<VerdictDeck | null> {
  const row = await db
    .select({ value: deckValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  const parsed = verdictDeckSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : null
}

export async function saveVerdictDeck(userId: string, deck: VerdictDeck): Promise<void> {
  const next = verdictDeckSchema.parse(deck)
  const now = new Date()
  await db
    .insert(userPreferences)
    .values({ userId, preferences: { [KAIROS_VERDICT_DECK_PREF_KEY]: next }, updatedAt: now })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_VERDICT_DECK_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
        updatedAt: now,
      },
    })
}

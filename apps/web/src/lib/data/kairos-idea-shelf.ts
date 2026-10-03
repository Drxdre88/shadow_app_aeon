import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_IDEA_SHELF_PREF_KEY } from '@/lib/kairos/ideas/pref-keys'
import { emptyShelf, pruneShelf } from '@/lib/kairos/incubation/shelf'
import { kairosIdeaShelfSchema, type KairosIdeaShelf } from './validators/kairos-idea-shelf'

export { KAIROS_IDEA_SHELF_PREF_KEY }

// The Kairos idea shelf lives as the server-owned `kairosIdeaShelf` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: every write runs mutateKairosIdeaShelf — SELECT … FOR UPDATE on the
// user's preferences row inside db.transaction, a pure mutation (policy in
// lib/kairos/incubation/shelf), pruning, then a jsonb merge of just this key.

export class KairosIdeaShelfCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosIdeaShelf preference is malformed: ${detail}`)
    this.name = 'KairosIdeaShelfCorruptError'
  }
}

// Missing key = an empty shelf. A present but malformed blob throws so no
// write path can silently clobber it.
export function parseIdeaShelf(raw: unknown): KairosIdeaShelf {
  if (raw === undefined || raw === null) return emptyShelf()
  const parsed = kairosIdeaShelfSchema.safeParse(raw)
  if (!parsed.success) throw new KairosIdeaShelfCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const shelfValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_IDEA_SHELF_PREF_KEY}::text`

export async function readKairosIdeaShelf(userId: string): Promise<KairosIdeaShelf> {
  const row = await db
    .select({ value: shelfValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseIdeaShelf(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type IdeaShelfMutation<R> = (shelf: KairosIdeaShelf) => { state: KairosIdeaShelf | null; result: R }

export async function mutateKairosIdeaShelf<R>(userId: string, mutate: IdeaShelfMutation<R>, now: Date = new Date()): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: shelfValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseIdeaShelf(rows[0]?.value))
      if (!state) return result
      const next = kairosIdeaShelfSchema.parse(pruneShelf(state, now))
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_IDEA_SHELF_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_IDEA_SHELF_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-idea-shelf: could not lock the preferences row')
  })
}

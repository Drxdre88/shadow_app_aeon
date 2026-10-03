import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_IDEA_ATLAS_PREF_KEY } from '@/lib/kairos/ideas/pref-keys'
import { emptyIdeaAtlasState, kairosIdeaAtlasStateSchema, type KairosIdeaAtlasState } from './validators/kairos-idea-atlas'

// The idea atlas lives as the server-owned `kairosIdeaAtlas` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: mutateKairosIdeaAtlas runs SELECT … FOR UPDATE on the user's
// preferences row inside db.transaction, a pure mutation (lib/kairos/ideas/
// atlas/update), then a jsonb merge of just this key.

export { KAIROS_IDEA_ATLAS_PREF_KEY }

export class KairosIdeaAtlasCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosIdeaAtlas preference is malformed: ${detail}`)
    this.name = 'KairosIdeaAtlasCorruptError'
  }
}

// Missing key = an empty atlas. A present but malformed blob throws so no
// write path can silently clobber it.
export function parseIdeaAtlasState(raw: unknown): KairosIdeaAtlasState {
  if (raw === undefined || raw === null) return emptyIdeaAtlasState()
  const parsed = kairosIdeaAtlasStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosIdeaAtlasCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const atlasValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_IDEA_ATLAS_PREF_KEY}::text`

export async function readKairosIdeaAtlas(userId: string): Promise<KairosIdeaAtlasState> {
  const row = await db
    .select({ value: atlasValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseIdeaAtlasState(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type IdeaAtlasMutation<R> = (state: KairosIdeaAtlasState) => { state: KairosIdeaAtlasState | null; result: R }

export async function mutateKairosIdeaAtlas<R>(userId: string, mutate: IdeaAtlasMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: atlasValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseIdeaAtlasState(rows[0]?.value))
      if (!state) return result
      const next = kairosIdeaAtlasStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_IDEA_ATLAS_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_IDEA_ATLAS_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-idea-atlas: could not lock the preferences row')
  })
}

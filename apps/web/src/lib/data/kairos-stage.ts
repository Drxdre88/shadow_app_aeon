import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { activeFocus, emptyStageState, londonCycleKey, rankCoalitions, surpriseSince } from '@/lib/kairos/stage/select'
import { kairosStageStateSchema, type KairosStageState, type StageCoalition } from './validators/kairos-stage'

// The Kairos stage (global workspace) lives as the server-owned `kairosStage`
// key inside user_preferences.preferences (no schema change). This module is
// the ONLY writer: every write runs mutateKairosStage — SELECT … FOR UPDATE on
// the user's preferences row inside db.transaction, a pure mutation (the
// selector in lib/kairos/stage), then a jsonb merge of just this key. Callers
// do their other reads BEFORE calling it (Neon pool acquire is 8s).
export const KAIROS_STAGE_PREF_KEY = 'kairosStage'

export class KairosStageCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosStage preference is malformed: ${detail}`)
    this.name = 'KairosStageCorruptError'
  }
}

// Missing key = an empty stage. A present but malformed blob throws so no
// write path can silently clobber it.
export function parseStageState(raw: unknown): KairosStageState {
  if (raw === undefined || raw === null) return emptyStageState()
  const parsed = kairosStageStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosStageCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const stageValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_STAGE_PREF_KEY}::text`

export async function readKairosStage(userId: string): Promise<KairosStageState> {
  const row = await db
    .select({ value: stageValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseStageState(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type StageMutation<R> = (state: KairosStageState) => { state: KairosStageState | null; result: R }

export async function mutateKairosStage<R>(userId: string, mutate: StageMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: stageValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseStageState(rows[0]?.value))
      if (!state) return result
      const next = kairosStageStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_STAGE_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_STAGE_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-stage: could not lock the preferences row')
  })
}

// ── Read view (MCP get_kairos_stage ≡ GET /api/v1/kairos/stage) ──────────

export interface KairosStageCoalitionView {
  id: string
  text: string
  strength: number
  wins: number
  deepBacked: boolean
  members: number
  echoes: number
  kinds: string[]
  firstAt: string
}

export interface KairosStageView {
  updatedAt: string | null
  cycle: string
  focus: { text: string; since: string; londonDate: string } | null
  top: KairosStageCoalitionView[]
  recentCycles: Array<{ cycle: string; winner: string | null; at: string }>
  surpriseLast24h: number
  poolSize: number
  pool?: KairosStageCoalitionView[]
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function coalitionView(c: StageCoalition, strength: number): KairosStageCoalitionView {
  return {
    id: c.id,
    text: c.text,
    strength: round3(strength),
    wins: c.wins,
    deepBacked: c.deepBacked,
    members: c.members.length,
    echoes: c.members.filter((m) => m.echo).length,
    kinds: [...new Set(c.members.map((m) => m.kind))],
    firstAt: c.firstAt,
  }
}

export function toKairosStageView(state: KairosStageState, opts: { now?: Date; pool?: boolean } = {}): KairosStageView {
  const now = opts.now ?? new Date()
  const ranked = rankCoalitions(state, now)
  const textOf = new Map(state.coalitions.map((c) => [c.id, c.text]))
  const focus = activeFocus(state, now)
  const view: KairosStageView = {
    updatedAt: state.updatedAt,
    cycle: londonCycleKey(now),
    focus: focus ? { text: focus.text, since: focus.since, londonDate: focus.londonDate } : null,
    top: ranked.slice(0, 4).map((r) => coalitionView(r.coalition, r.strength)),
    recentCycles: state.cycles.slice(-6).map((c) => ({ cycle: c.cycle, winner: c.winnerId ? textOf.get(c.winnerId) ?? null : null, at: c.at })),
    surpriseLast24h: round3(surpriseSince(state, new Date(now.getTime() - 86_400_000), now)),
    poolSize: state.coalitions.length,
  }
  if (opts.pool) view.pool = ranked.map((r) => coalitionView(r.coalition, r.strength))
  return view
}

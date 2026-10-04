import { db } from '@/lib/db'
import { dominionObjectives, memories, userPreferences } from '@/lib/db/schema'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { KAIROS_RAPPORT_PREF_KEY } from '@/lib/kairos/moment/pref-keys'
import { balanceOf } from '@/lib/kairos/rapport/readiness'
import { emptyRapport, pruneRapport, type ObjectiveRef } from '@/lib/kairos/rapport/state'
import type { RapportModes } from '@/lib/kairos/rapport/flag'
import {
  RAPPORT_SOFT_WINDOW_MS,
  kairosRapportSchema,
  type KairosRapport,
  type KairosRapportView,
} from './validators/kairos-rapport'

// Rapport state lives as the server-owned `kairosRapport` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: every write runs mutateKairosRapport — SELECT … FOR UPDATE on the
// user's preferences row inside db.transaction, a pure mutation (policy in
// lib/kairos/rapport), pruneRapport, then a jsonb merge of just this key.

export { KAIROS_RAPPORT_PREF_KEY }

export class KairosRapportCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosRapport preference is malformed: ${detail}`)
    this.name = 'KairosRapportCorruptError'
  }
}

export function parseRapport(raw: unknown, now: Date = new Date()): KairosRapport {
  if (raw === undefined || raw === null) return emptyRapport(now)
  const parsed = kairosRapportSchema.safeParse(raw)
  if (!parsed.success) throw new KairosRapportCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const rapportValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_RAPPORT_PREF_KEY}::text`

// Read with the time-driven transitions applied (nothing written).
export async function readKairosRapport(userId: string, now: Date = new Date()): Promise<KairosRapport> {
  const row = await db
    .select({ value: rapportValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return pruneRapport(parseRapport(row?.value, now), now)
}

export type RapportMutation<R> = (state: KairosRapport) => { state: KairosRapport | null; result: R }

export async function mutateKairosRapport<R>(userId: string, mutate: RapportMutation<R>, now: Date = new Date()): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: rapportValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(pruneRapport(parseRapport(rows[0]?.value, now), now))
      if (!state) return result
      const next = kairosRapportSchema.parse(pruneRapport(state, now))
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_RAPPORT_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_RAPPORT_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-rapport: could not lock the preferences row')
  })
}

// The owner's own goals: active or paused, unarchived dominion objectives.
export async function listObjectiveRefs(userId: string, limit = 50): Promise<ObjectiveRef[]> {
  return db
    .select({ id: dominionObjectives.id, title: dominionObjectives.title })
    .from(dominionObjectives)
    .where(and(
      eq(dominionObjectives.userId, userId),
      inArray(dominionObjectives.status, ['active', 'paused']),
      isNull(dominionObjectives.archivedAt),
    ))
    .orderBy(asc(dominionObjectives.sortOrder))
    .limit(Math.min(Math.max(limit, 1), 100))
}

export const IGNORED_AFTER_HOURS = 24
const IGNORED_LOOKBACK_DAYS = 7

// Conversational Kairos speaks still pending more than 24h after they were
// SENT (newest first). Held rows are status 'held', never 'pending', so they
// are skipped; a gate-released row is measured from gate.releasedAt.
const speakSentAtSql = sql`coalesce((${memories.sourceMetadata}->'gate'->>'releasedAt')::timestamptz, ${memories.createdAt})`

export async function listIgnoredKairosSpeakIds(userId: string, now: Date = new Date()): Promise<string[]> {
  const until = new Date(now.getTime() - IGNORED_AFTER_HOURS * 3_600_000)
  const since = new Date(now.getTime() - IGNORED_LOOKBACK_DAYS * 86_400_000)
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      eq(memories.source, 'system'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      sql`${memories.sourceMetadata}->>'status' = 'pending'`,
      sql`(${memories.sourceMetadata}->>'opsAlert') IS DISTINCT FROM 'true'`,
      sql`(${memories.sourceMetadata}->>'digest') IS DISTINCT FROM 'true'`,
      gte(memories.createdAt, since),
      sql`${speakSentAtSql} <= ${until.toISOString()}::timestamptz`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(10)
  return rows.map((r) => r.id)
}

// ── Read view (MCP get_kairos_rapport ≡ GET /api/v1/kairos/rapport) ────────

function tally<K extends string>(items: readonly { kind: K }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) out[i.kind] = (out[i.kind] ?? 0) + 1
  return out
}

export function toKairosRapportView(state: KairosRapport, opts: { now?: Date; modes: RapportModes }): KairosRapportView {
  const now = opts.now ?? new Date()
  const softFloor = now.getTime() - RAPPORT_SOFT_WINDOW_MS
  const r = state.rupture
  return {
    flags: { ...opts.modes },
    rupture: {
      state: r.state,
      since: r.since,
      reason: r.reason ?? null,
      cooldownH: r.cooldownH,
      lastRepairAt: r.lastRepairAt ?? null,
      soft72h: tally(r.soft.filter((s) => Date.parse(s.at) >= softFloor)),
    },
    goals: Object.entries(state.goals)
      .sort((a, b) => Date.parse(b[1].lastSeen) - Date.parse(a[1].lastSeen))
      .map(([objectiveId, g]) => ({
        objectiveId,
        title: g.title,
        band: g.band,
        balance: balanceOf(g),
        lastTip: g.lastTip ? { kind: g.lastTip.kind, at: g.lastTip.at } : null,
        lastSeen: g.lastSeen,
      })),
    bids30d: { count: state.bids.length, byKind: tally(state.bids) },
    turns: { n: state.turns.n, lenEwma: state.turns.lenEwma, baseline: state.turns.baseline14d, terseRun: state.turns.terseRun },
  }
}

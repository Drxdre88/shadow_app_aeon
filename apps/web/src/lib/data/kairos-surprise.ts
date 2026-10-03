import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { emptySurpriseLedger, pruneSurpriseLedger } from '@/lib/kairos/surprise/ledger'
import {
  SURPRISE_RETENTION_MS,
  kairosSurpriseLedgerSchema,
  type KairosSurpriseLedger,
  type KairosSurpriseView,
  type SurpriseEvent,
  type SurpriseEventView,
} from './validators/kairos-surprise'

// The Kairos surprise ledger lives as the server-owned `kairosSurprise` key
// inside user_preferences.preferences (no schema change). This module is the
// ONLY writer: every write runs mutateKairosSurprise — SELECT … FOR UPDATE on
// the user's preferences row inside db.transaction, a pure mutation (policy in
// lib/kairos/surprise/ledger), the caps (pruneSurpriseLedger), then a jsonb
// merge of just this key. Callers do their other reads BEFORE calling it.
export const KAIROS_SURPRISE_PREF_KEY = 'kairosSurprise'

export class KairosSurpriseCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosSurprise preference is malformed: ${detail}`)
    this.name = 'KairosSurpriseCorruptError'
  }
}

// Missing key = an empty ledger. A present but malformed blob throws so no
// write path can silently clobber it.
export function parseSurpriseLedger(raw: unknown): KairosSurpriseLedger {
  if (raw === undefined || raw === null) return emptySurpriseLedger()
  const parsed = kairosSurpriseLedgerSchema.safeParse(raw)
  if (!parsed.success) throw new KairosSurpriseCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const surpriseValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_SURPRISE_PREF_KEY}::text`

export async function readKairosSurprise(userId: string): Promise<KairosSurpriseLedger> {
  const row = await db
    .select({ value: surpriseValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseSurpriseLedger(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type SurpriseMutation<R> = (ledger: KairosSurpriseLedger) => { state: KairosSurpriseLedger | null; result: R }

export async function mutateKairosSurprise<R>(userId: string, mutate: SurpriseMutation<R>, now: Date = new Date()): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: surpriseValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseSurpriseLedger(rows[0]?.value))
      if (!state) return result
      const next = kairosSurpriseLedgerSchema.parse(pruneSurpriseLedger(state, now))
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_SURPRISE_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_SURPRISE_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-surprise: could not lock the preferences row')
  })
}

// ── Read view (MCP get_kairos_surprise ≡ GET /api/v1/kairos/surprise) ──────

const round3 = (n: number) => Math.round(n * 1000) / 1000

function eventView(e: SurpriseEvent): SurpriseEventView {
  return {
    id: e.id,
    at: e.at,
    kind: e.kind,
    s: e.s,
    dominionId: e.dominionId,
    beliefs: e.refs.beliefIds.length,
    memories: e.refs.memoryIds.length,
    opened: e.opened.length,
    credited: e.credited ?? null,
  }
}

// Newest events first (≤`limit`), a 7-day tally, and the lp / replay blocks.
// Events are summarised (ref counts, not ids; no idempotency keys).
export function toKairosSurpriseView(ledger: KairosSurpriseLedger, opts: { now?: Date; limit?: number } = {}): KairosSurpriseView {
  const now = opts.now ?? new Date()
  const cutoff = now.getTime() - SURPRISE_RETENTION_MS
  const recent = ledger.events.filter((e) => Date.parse(e.at) >= cutoff)
  const byKind: Record<string, number> = {}
  for (const e of recent) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  return {
    events: [...ledger.events].reverse().slice(0, opts.limit ?? 20).map(eventView),
    last7d: { count: recent.length, sumS: round3(recent.reduce((a, e) => a + e.s, 0)), byKind },
    lp: ledger.lp,
    replay: ledger.replay,
  }
}

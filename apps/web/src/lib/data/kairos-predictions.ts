import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_PREDICTIONS_PREF_KEY } from './preferences'
import {
  kairosPredictionsStateSchema,
  type KairosPrediction,
  type KairosPredictionsState,
  type ListKairosPredictionsInput,
} from './validators/kairos-predictions'

// Kairos predictions live as the server-owned `kairosPredictions` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: every write runs mutateKairosPredictions — SELECT … FOR UPDATE on
// the user's preferences row inside db.transaction, a pure mutation, then a
// jsonb merge of just this key. upsertPreferences (theme sync) strips and
// carries the key over, so a theme save can neither set nor wipe it.

export class KairosPredictionsCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosPredictions preference is malformed: ${detail}`)
    this.name = 'KairosPredictionsCorruptError'
  }
}

export function emptyPredictionsState(): KairosPredictionsState {
  return { v: 1, nextSeq: 1, open: [], closed: [] }
}

// Missing key = no predictions yet. A present but malformed blob throws so no
// write path can silently clobber it.
export function parsePredictionsState(raw: unknown): KairosPredictionsState {
  if (raw === undefined || raw === null) return emptyPredictionsState()
  const parsed = kairosPredictionsStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosPredictionsCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const predictionsValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_PREDICTIONS_PREF_KEY}::text`

export async function readKairosPredictions(userId: string): Promise<KairosPredictionsState> {
  const row = await db
    .select({ value: predictionsValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parsePredictionsState(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type PredictionsMutation<R> = (state: KairosPredictionsState) => { state: KairosPredictionsState | null; result: R }

export async function mutateKairosPredictions<R>(userId: string, mutate: PredictionsMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: predictionsValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parsePredictionsState(rows[0]?.value))
      if (!state) return result
      const next = kairosPredictionsStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_PREDICTIONS_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_PREDICTIONS_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-predictions: could not lock the preferences row')
  })
}

// ── Reads ────────────────────────────────────────────────────────────────

export interface KairosPredictionView {
  id: string
  number: string
  seq: number
  claim: string
  probability: number
  dueDate: string
  topic: KairosPrediction['topic']
  dominionId: string | null
  status: KairosPrediction['status']
  check: KairosPrediction['check']['kind']
  expect: 'done' | 'not_done' | null
  source: KairosPrediction['source']['kind']
  createdAt: string
  settledAt: string | null
  settledBy: NonNullable<KairosPrediction['settledBy']>['kind'] | null
}

export function toKairosPredictionView(p: KairosPrediction): KairosPredictionView {
  return {
    id: p.id,
    number: `R${p.seq}`,
    seq: p.seq,
    claim: p.claim,
    probability: p.probability,
    dueDate: p.dueDate,
    topic: p.topic,
    dominionId: p.dominionId,
    status: p.status,
    check: p.check.kind,
    expect: p.check.kind === 'card_by' ? p.check.expect : null,
    source: p.source.kind,
    createdAt: p.createdAt,
    settledAt: p.settledAt ?? null,
    settledBy: p.settledBy?.kind ?? null,
  }
}

export interface KairosPredictionsList {
  predictions: KairosPrediction[]
  // Always the full closed history (the score is computed over it).
  closed: KairosPrediction[]
}

// Open predictions by R-number; scope 'all' appends the closed history (newest first).
export async function listKairosPredictions(userId: string, input: ListKairosPredictionsInput): Promise<KairosPredictionsList> {
  const state = await readKairosPredictions(userId)
  const open = [...state.open].sort((a, b) => a.seq - b.seq)
  return { predictions: input.scope === 'all' ? [...open, ...state.closed] : open, closed: state.closed }
}

// The R-number lookup ("R3 right"): the unsettled prediction numbered `seq`, or null.
export async function findOpenKairosPredictionBySeq(userId: string, seq: number): Promise<KairosPrediction | null> {
  const state = await readKairosPredictions(userId)
  return state.open.find((p) => p.seq === seq) ?? null
}

import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_DECISIONS_PREF_KEY } from '@/lib/kairos/decisions/pref-keys'
import {
  confirmInState,
  discardInState,
  emptyDecisionsState,
  logInState,
  settleInState,
  sortOpenDecisions,
  toDecisionView,
  type DecisionRefusal,
  type DecisionStep,
} from '@/lib/kairos/decisions/journal'
import { calibrateDecisions } from '@/lib/kairos/decisions/score'
import type { KairosDecisionView, KairosDecisionsList } from '@/lib/kairos/decisions/types'
import {
  decisionOriginSchema,
  decisionSettledViaSchema,
  decisionVerdictSchema,
  kairosDecisionsStateSchema,
  type DecisionOrigin,
  type DecisionSettledVia,
  type DecisionVerdict,
  type KairosDecision,
  type KairosDecisionsState,
  type ListDecisionsInput,
  type LogDecisionInput,
} from './validators/kairos-decisions'

// The owner's decision journal lives as the server-owned `kairosDecisions`
// key inside user_preferences.preferences (no schema change). This module is
// the ONLY writer: every write runs mutateKairosDecisions — SELECT … FOR
// UPDATE on the user's preferences row inside db.transaction, a pure step,
// then a jsonb merge of just this key. Settling, confirming and discarding
// are owner-only (session actions, the operator Telegram chat); MCP and REST
// may only log (marked relayed) and list.

export class KairosDecisionsCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosDecisions preference is malformed: ${detail}`)
    this.name = 'KairosDecisionsCorruptError'
  }
}

export function parseDecisionsState(raw: unknown): KairosDecisionsState {
  if (raw === undefined || raw === null) return emptyDecisionsState()
  const parsed = kairosDecisionsStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosDecisionsCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const decisionsValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_DECISIONS_PREF_KEY}::text`

export async function readKairosDecisions(userId: string): Promise<KairosDecisionsState> {
  const row = await db
    .select({ value: decisionsValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseDecisionsState(row?.value)
}

export type DecisionsMutation<R> = (state: KairosDecisionsState) => { state: KairosDecisionsState | null; result: R }

export async function mutateKairosDecisions<R>(userId: string, mutate: DecisionsMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: decisionsValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseDecisionsState(rows[0]?.value))
      if (!state) return result
      const next = kairosDecisionsStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_DECISIONS_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_DECISIONS_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-decisions: could not lock the preferences row')
  })
}

export type DecisionResult =
  | { ok: true; decision: KairosDecisionView }
  | { ok: false; reason: DecisionRefusal | 'forbidden' | 'invalid_verdict' }

function applyStep(userId: string, step: (state: KairosDecisionsState) => DecisionStep, now: Date): Promise<DecisionResult> {
  return mutateKairosDecisions<DecisionResult>(userId, (state) => {
    const res = step(state)
    if (!res.ok) return { state: null, result: { ok: false, reason: res.reason } }
    return { state: res.state, result: { ok: true, decision: toDecisionView(res.decision, now) } }
  })
}

export async function logKairosDecision(
  userId: string,
  input: LogDecisionInput,
  origin: DecisionOrigin,
  now: Date = new Date(),
): Promise<DecisionResult> {
  const by = decisionOriginSchema.safeParse(origin)
  if (!by.success) return { ok: false, reason: 'forbidden' }
  const id = randomUUID()
  return applyStep(userId, (state) => logInState(state, input, by.data, id, now), now)
}

export interface DecisionOwner { via: DecisionSettledVia }

export async function settleKairosDecisionByOwner(
  userId: string,
  decisionId: string,
  verdict: DecisionVerdict,
  owner: DecisionOwner,
  now: Date = new Date(),
): Promise<DecisionResult> {
  const via = decisionSettledViaSchema.safeParse(owner?.via)
  if (!via.success) return { ok: false, reason: 'forbidden' }
  const v = decisionVerdictSchema.safeParse(verdict)
  if (!v.success) return { ok: false, reason: 'invalid_verdict' }
  return applyStep(userId, (state) => settleInState(state, decisionId, v.data, via.data, now), now)
}

export async function confirmKairosDecisionByOwner(userId: string, decisionId: string, now: Date = new Date()): Promise<DecisionResult> {
  return applyStep(userId, (state) => confirmInState(state, decisionId, now), now)
}

export async function discardRelayedKairosDecision(userId: string, decisionId: string, now: Date = new Date()): Promise<DecisionResult> {
  return applyStep(userId, (state) => discardInState(state, decisionId), now)
}

export async function listKairosDecisions(
  userId: string,
  input: Pick<ListDecisionsInput, 'scope'>,
  now: Date = new Date(),
): Promise<KairosDecisionsList> {
  const state = await readKairosDecisions(userId)
  const open = sortOpenDecisions(state.open)
  const rows = input.scope === 'all' ? [...open, ...state.closed] : open
  return { decisions: rows.map((d) => toDecisionView(d, now)), calibration: calibrateDecisions(state.closed) }
}

export async function findOpenKairosDecisionBySeq(userId: string, seq: number): Promise<KairosDecision | null> {
  const state = await readKairosDecisions(userId)
  return state.open.find((d) => d.seq === seq) ?? null
}

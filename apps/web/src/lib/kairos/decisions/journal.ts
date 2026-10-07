import {
  MAX_CLOSED_DECISIONS,
  MAX_OPEN_DECISIONS,
  type DecisionOrigin,
  type DecisionSettledVia,
  type DecisionVerdict,
  type KairosDecision,
  type KairosDecisionsState,
  type LogDecisionInput,
} from '@/lib/data/validators/kairos-decisions'
import { decisionTypeLabel, normalizeDecisionType, type KairosDecisionView } from './types'

// Pure state transitions for the decision journal. The data layer runs each
// inside its single locked writer; nothing here touches the database.

export type DecisionRefusal = 'not_found' | 'already_settled' | 'unconfirmed' | 'not_relayed' | 'past_check_by' | 'full'

export type DecisionStep =
  | { ok: true; state: KairosDecisionsState; decision: KairosDecision }
  | { ok: false; reason: DecisionRefusal }

export function emptyDecisionsState(): KairosDecisionsState {
  return { v: 1, nextSeq: 1, open: [], closed: [] }
}

export function londonDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function needsConfirm(d: KairosDecision): boolean {
  return d.origin.kind === 'relayed' && !d.confirmedAt
}

export function logInState(
  state: KairosDecisionsState,
  input: LogDecisionInput,
  origin: DecisionOrigin,
  id: string,
  now: Date,
): DecisionStep {
  if (input.checkBy < londonDate(now)) return { ok: false, reason: 'past_check_by' }
  if (state.open.length >= MAX_OPEN_DECISIONS) return { ok: false, reason: 'full' }
  const decision: KairosDecision = {
    id,
    seq: state.nextSeq,
    decision: input.decision,
    expectation: input.expectation,
    probability: input.probability,
    decisionType: normalizeDecisionType(input.decisionType),
    checkBy: input.checkBy,
    origin,
    createdAt: now.toISOString(),
    status: 'open',
  }
  return { ok: true, decision, state: { ...state, nextSeq: state.nextSeq + 1, open: [...state.open, decision] } }
}

function openOrRefusal(state: KairosDecisionsState, decisionId: string): KairosDecision | DecisionRefusal {
  const found = state.open.find((d) => d.id === decisionId)
  if (found) return found
  return state.closed.some((d) => d.id === decisionId) ? 'already_settled' : 'not_found'
}

export function settleInState(
  state: KairosDecisionsState,
  decisionId: string,
  verdict: DecisionVerdict,
  via: DecisionSettledVia,
  now: Date,
): DecisionStep {
  const found = openOrRefusal(state, decisionId)
  if (typeof found === 'string') return { ok: false, reason: found }
  if (needsConfirm(found)) return { ok: false, reason: 'unconfirmed' }
  const decision: KairosDecision = { ...found, status: verdict, settledAt: now.toISOString(), settledVia: via }
  return {
    ok: true,
    decision,
    state: {
      ...state,
      open: state.open.filter((d) => d.id !== decisionId),
      closed: [decision, ...state.closed].slice(0, MAX_CLOSED_DECISIONS),
    },
  }
}

export function confirmInState(state: KairosDecisionsState, decisionId: string, now: Date): DecisionStep {
  const found = openOrRefusal(state, decisionId)
  if (typeof found === 'string') return { ok: false, reason: found }
  if (!needsConfirm(found)) return { ok: false, reason: 'not_relayed' }
  const decision: KairosDecision = { ...found, confirmedAt: now.toISOString() }
  return { ok: true, decision, state: { ...state, open: state.open.map((d) => (d.id === decisionId ? decision : d)) } }
}

export function discardInState(state: KairosDecisionsState, decisionId: string): DecisionStep {
  const found = openOrRefusal(state, decisionId)
  if (typeof found === 'string') return { ok: false, reason: found }
  if (!needsConfirm(found)) return { ok: false, reason: 'not_relayed' }
  return { ok: true, decision: found, state: { ...state, open: state.open.filter((d) => d.id !== decisionId) } }
}

export function sortOpenDecisions(open: readonly KairosDecision[]): KairosDecision[] {
  return [...open].sort((a, b) => a.checkBy.localeCompare(b.checkBy) || a.seq - b.seq)
}

export function toDecisionView(d: KairosDecision, now: Date): KairosDecisionView {
  return {
    id: d.id,
    number: `D${d.seq}`,
    seq: d.seq,
    decision: d.decision,
    expectation: d.expectation,
    probability: d.probability,
    decisionType: d.decisionType,
    typeLabel: decisionTypeLabel(d.decisionType),
    checkBy: d.checkBy,
    due: d.status === 'open' && d.checkBy <= londonDate(now),
    status: d.status,
    relayed: d.origin.kind === 'relayed',
    needsConfirm: needsConfirm(d),
    createdAt: d.createdAt,
    settledAt: d.settledAt ?? null,
  }
}

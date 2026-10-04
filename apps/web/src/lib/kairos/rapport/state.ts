import {
  RAPPORT_BID_RETENTION_MS,
  RAPPORT_MAX_BIDS,
  RAPPORT_MAX_GOALS,
  type BidKind,
  type KairosRapport,
  type RapportGoal,
  type RapportTip,
} from '@/lib/data/validators/kairos-rapport'
import type { RapportModes } from './flag'
import { detectBid, detectNotNow, goalTerms, hasChangeTalk, isTerse, scoreChangeTalk, wordCount } from './lexicon'
import { applyGoalTurn, tipForTurn, type GoalTurn } from './readiness'
import { advanceRupture, emptyRupture, onOwnerMessage, recordNotNow, recordSoft } from './repair'

export interface ObjectiveRef {
  id: string
  title: string
}

export interface OwnerTurnInput {
  ref: string
  body: string
  at: Date
  modes: RapportModes
  objectives: readonly ObjectiveRef[]
}

export interface OwnerTurnEffects {
  tip: (RapportTip & { objectiveId: string; title: string }) | null
  bid: BidKind | null
  notNow: boolean
  terse: boolean
}

const LEN_ALPHA = 0.3
const BASELINE_ALPHA = 0.05
export const TERSE_RUN_SIGNAL = 3
export const TERSE_MIN_TURNS = 10
export const TERSE_MIN_BASELINE = 6

export function emptyRapport(now: Date): KairosRapport {
  return {
    v: 1,
    goals: {},
    turns: { lenEwma: 0, baseline14d: 0, terseRun: 0, n: 0, lastAt: null },
    bids: [],
    rupture: emptyRupture(now),
  }
}

const round = (n: number): number => Math.round(n * 100) / 100

export function pruneRapport(state: KairosRapport, now: Date): KairosRapport {
  const floor = now.getTime() - RAPPORT_BID_RETENTION_MS
  const goals = Object.entries(state.goals)
    .sort((a, b) => Date.parse(b[1].lastSeen) - Date.parse(a[1].lastSeen))
    .slice(0, RAPPORT_MAX_GOALS)
  return {
    ...state,
    goals: Object.fromEntries(goals),
    bids: state.bids.filter((b) => Date.parse(b.at) >= floor).slice(-RAPPORT_MAX_BIDS),
    rupture: advanceRupture(state.rupture, now, state.turns.lastAt),
  }
}

export function matchObjective(objectives: readonly ObjectiveRef[], body: string): ObjectiveRef | null {
  const terms = new Set(goalTerms(body))
  if (terms.size === 0) return null
  let best: ObjectiveRef | null = null
  let bestHits = 0
  for (const o of objectives) {
    const hits = goalTerms(o.title).filter((t) => terms.has(t)).length
    if (hits > bestHits) {
      best = o
      bestHits = hits
    }
  }
  return best
}

export function goalTurnFor(input: Pick<OwnerTurnInput, 'ref' | 'body' | 'at' | 'objectives'>): GoalTurn | null {
  const talk = scoreChangeTalk(input.body)
  if (!hasChangeTalk(talk)) return null
  const objective = matchObjective(input.objectives, input.body)
  if (!objective) return null
  return { objectiveId: objective.id, title: objective.title, ref: input.ref, talk, at: input.at }
}

// The readiness tip this turn produces (read-only; safe to run alongside the capture).
export function previewTip(state: KairosRapport, turn: GoalTurn | null): OwnerTurnEffects['tip'] {
  if (!turn) return null
  const tip = tipForTurn(state.goals[turn.objectiveId], turn)
  return tip ? { ...tip, objectiveId: turn.objectiveId, title: turn.title } : null
}

function nextTurns(turns: KairosRapport['turns'], body: string, at: Date): KairosRapport['turns'] {
  const words = wordCount(body)
  const first = turns.n === 0
  return {
    lenEwma: round(first ? words : LEN_ALPHA * words + (1 - LEN_ALPHA) * turns.lenEwma),
    baseline14d: round(first ? words : BASELINE_ALPHA * words + (1 - BASELINE_ALPHA) * turns.baseline14d),
    terseRun: isTerse(body) ? turns.terseRun + 1 : 0,
    n: turns.n + 1,
    lastAt: at.toISOString(),
  }
}

export function applyOwnerTurn(state: KairosRapport, input: OwnerTurnInput): { state: KairosRapport; effects: OwnerTurnEffects } {
  const { ref, body, at, modes } = input
  const effects: OwnerTurnEffects = { tip: null, bid: null, notNow: false, terse: false }
  const before = state.turns
  const turns = nextTurns(before, body, at)
  let rupture = advanceRupture(state.rupture, at, before.lastAt)
  let goals: Record<string, RapportGoal> = state.goals
  let bids = state.bids

  if (modes.repair !== 'off') {
    rupture = onOwnerMessage(rupture, at)
    if (detectNotNow(body)) {
      effects.notNow = true
      rupture = recordNotNow(rupture, body, at)
    } else if (turns.terseRun === TERSE_RUN_SIGNAL && before.n >= TERSE_MIN_TURNS && before.baseline14d >= TERSE_MIN_BASELINE) {
      effects.terse = true
      rupture = recordSoft(rupture, { at: at.toISOString(), kind: 'terse', ref: `terse:${ref}`.slice(0, 100) }, at)
    }
  }

  if (modes.bids !== 'off') {
    const bid = detectBid(body)
    if (bid && !bids.some((b) => b.ref === ref)) {
      effects.bid = bid
      bids = [...bids, { at: at.toISOString(), kind: bid, ref }]
    }
  }

  if (modes.readiness !== 'off') {
    const turn = goalTurnFor(input)
    if (turn) {
      const update = applyGoalTurn(goals[turn.objectiveId], turn)
      if (!update.duplicate) goals = { ...goals, [turn.objectiveId]: update.goal }
      if (update.tip) effects.tip = { ...update.tip, objectiveId: turn.objectiveId, title: turn.title }
    }
  }

  return { state: { ...state, goals, turns, bids, rupture }, effects }
}

export function recordMediaBid(state: KairosRapport, ref: string, at: Date): { state: KairosRapport; fresh: boolean } {
  if (state.bids.some((b) => b.ref === ref)) return { state, fresh: false }
  return { state: { ...state, bids: [...state.bids, { at: at.toISOString(), kind: 'media', ref }] }, fresh: true }
}

// A Kairos reply that followed a readiness tip in the same thread: stamp it offered / reflected.
export function stampTipAnswered(state: KairosRapport, threadId: string, at: Date): KairosRapport | null {
  const prefix = `chat:${threadId}:`
  let changed = false
  const goals: Record<string, RapportGoal> = {}
  for (const [id, goal] of Object.entries(state.goals)) {
    const tip = goal.lastTip
    const answered = tip?.kind === 'commit' ? goal.offeredAt : goal.reflectedAt
    if (tip?.ref?.startsWith(prefix) && !answered && at.getTime() - Date.parse(tip.at) <= 3_600_000) {
      goals[id] = { ...goal, ...(tip.kind === 'commit' ? { offeredAt: at.toISOString() } : { reflectedAt: at.toISOString() }) }
      changed = true
    } else goals[id] = goal
  }
  return changed ? { ...state, goals } : null
}

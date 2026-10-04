import type { RapportGoal, RapportTip, ReadinessBand } from '@/lib/data/validators/kairos-rapport'
import type { ChangeTalk } from './lexicon'

// Readiness per owner goal: change-talk tallies decay with a 7-day half-life;
// the balance B = (commit − sustain) / (commit + prep + sustain + 1) moves the
// band. A tip (into committed, or back out of it) fires at most once per goal
// per 7 days; the same message ref is never counted twice.

export const READINESS_HALF_LIFE_DAYS = 7
export const COMMIT_BALANCE = 0.35
export const WAVER_BALANCE = 0.1
export const TIP_COOLDOWN_MS = 7 * 86_400_000
const DAY_MS = 86_400_000
const PREPARING_FLOOR = 0.5

export interface GoalTurn {
  objectiveId: string
  title: string
  ref: string
  talk: ChangeTalk
  at: Date
}

export interface GoalUpdate {
  goal: RapportGoal
  tip: RapportTip | null
  duplicate: boolean
}

const round = (n: number): number => Math.round(n * 1000) / 1000

export function balanceOf(goal: Pick<RapportGoal, 'commit' | 'prep' | 'sustain'>): number {
  return round((goal.commit - goal.sustain) / (goal.commit + goal.prep + goal.sustain + 1))
}

export function decayFactor(fromIso: string, to: Date): number {
  const dt = (to.getTime() - Date.parse(fromIso)) / DAY_MS
  if (!Number.isFinite(dt) || dt <= 0) return 1
  return Math.pow(0.5, dt / READINESS_HALF_LIFE_DAYS)
}

export function nextBand(prev: ReadinessBand, t: Pick<RapportGoal, 'commit' | 'prep' | 'sustain'>): ReadinessBand {
  const b = balanceOf(t)
  if (b >= COMMIT_BALANCE && t.commit >= 1) return 'committed'
  if (prev === 'committed') return b < WAVER_BALANCE || t.sustain > t.commit ? 'wavering' : 'committed'
  if (prev === 'wavering') return 'wavering'
  return t.commit + t.prep + t.sustain >= PREPARING_FLOOR ? 'preparing' : 'none'
}

function tipKind(prev: ReadinessBand, next: ReadinessBand): RapportTip['kind'] | null {
  if (next === 'committed' && prev !== 'committed') return 'commit'
  if (prev === 'committed' && next === 'wavering') return 'back'
  return null
}

function tipAllowed(goal: RapportGoal | undefined, at: Date): boolean {
  if (!goal?.lastTip) return true
  return at.getTime() - Date.parse(goal.lastTip.at) >= TIP_COOLDOWN_MS
}

function markerFor(kind: RapportTip['kind'], talk: ChangeTalk): string {
  return (talk.markers[0] ?? (kind === 'commit' ? 'commitment' : 'sustain talk')).slice(0, 60)
}

export function applyGoalTurn(prev: RapportGoal | undefined, turn: GoalTurn): GoalUpdate {
  if (prev && prev.lastRef === turn.ref) return { goal: prev, tip: null, duplicate: true }
  const f = prev ? decayFactor(prev.lastSeen, turn.at) : 1
  const tallies = {
    commit: round((prev?.commit ?? 0) * f + turn.talk.commit),
    prep: round((prev?.prep ?? 0) * f + turn.talk.prep),
    sustain: round((prev?.sustain ?? 0) * f + turn.talk.sustain),
  }
  const before = prev?.band ?? 'none'
  const band = nextBand(before, tallies)
  const kind = tipKind(before, band)
  const tip = kind && tipAllowed(prev, turn.at)
    ? { kind, at: turn.at.toISOString(), marker: markerFor(kind, turn.talk), ref: turn.ref }
    : null
  const goal: RapportGoal = {
    title: turn.title.slice(0, 120) || 'goal',
    ...tallies,
    band,
    lastRef: turn.ref,
    lastSeen: turn.at.toISOString(),
    ...(tip ? { lastTip: tip } : prev?.lastTip ? { lastTip: prev.lastTip } : {}),
    ...(prev?.offeredAt && !tip ? { offeredAt: prev.offeredAt } : {}),
    ...(prev?.reflectedAt && !tip ? { reflectedAt: prev.reflectedAt } : {}),
  }
  return { goal, tip, duplicate: false }
}

// The tip produced by this exact turn, whether or not the owner-turn hook has
// already stored it (the chat prompt and the capture run concurrently).
export function tipForTurn(prev: RapportGoal | undefined, turn: GoalTurn): RapportTip | null {
  if (prev && prev.lastRef === turn.ref) return prev.lastTip?.ref === turn.ref ? prev.lastTip : null
  return applyGoalTurn(prev, turn).tip
}

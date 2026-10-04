import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import { rowOutcome } from '@/lib/kairos/ideas/stepping/stones'
import { SCORE_WINDOW_DAYS, TRACK_RECORD_MIN_N, metricsFor } from '@/lib/kairos/predictions/score'
import { TOPIC_LABELS, topicKey } from './areas'
import { buildTrustStatement } from './statement'
import type { TrustArea, TrustComputed, TrustInputs, TrustLevel, TrustScored, TrustWentAhead } from './types'

// Pure trust maths. Scored = settled right/wrong predictions + goals the owner
// took that closed + goal-linked promises that closed, inside the window.
// Ideas and corrections are counted for display only.

export const TRUST_WINDOW_DAYS = SCORE_WINDOW_DAYS
export const TRUST_MIN_N = TRACK_RECORD_MIN_N
export const WENT_AHEAD_MIN = 3
export const CORRECTIONS_WINDOW_DAYS = 7
const WILSON_Z_80 = 1.2816
const DAY_MS = 86_400_000

const LANDED = new Set(['done'])
const MISSED = new Set(['failed', 'abandoned'])
const TAKEN = new Set(['active', 'done', 'failed', 'abandoned'])

const round = (x: number, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp

const inWindow = (iso: string | null | undefined, since: number): boolean => {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= since
}

export function wilsonLowerBound(right: number, n: number, z = WILSON_Z_80): number {
  if (n <= 0) return 0
  const p = right / n
  const z2 = z * z
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / (1 + z2 / n))
}

export function scoreOf(right: number, n: number): TrustScored {
  return { n, right, reliability: round((right + 2) / (n + 4)), lowerBound: round(wilsonLowerBound(right, n)) }
}

export function levelFor(scored: TrustScored, overconfidence: number, wentAhead: TrustWentAhead): TrustLevel {
  if (scored.n < TRUST_MIN_N) return 'unknown'
  const ownerKeepsWinning = wentAhead.n >= WENT_AHEAD_MIN && wentAhead.ownerRight / wentAhead.n >= 0.6
  if (scored.reliability < 0.5 || overconfidence > 0.15 || ownerKeepsWinning) return 'check'
  if (scored.reliability >= 0.7 && scored.lowerBound >= 0.5 && overconfidence <= 0.1) return 'lean'
  return 'second'
}

interface Bucket {
  key: string
  kind: TrustArea['kind']
  label: string
  calls: KairosPrediction[]
  goals: TrustArea['goals']
  promises: TrustArea['promises']
  ideas: TrustArea['ideas']
  corrections7d: number
}

const emptyBucket = (key: string, kind: TrustArea['kind'], label: string): Bucket => ({
  key, kind, label, calls: [],
  goals: { taken: 0, landed: 0, missed: 0, vetoed: 0 },
  promises: { kept: 0, missed: 0 },
  ideas: { accepted: 0, dismissed: 0 },
  corrections7d: 0,
})

function wentAheadOf(calls: readonly KairosPrediction[]): TrustWentAhead {
  const doubted = calls.filter((p) => p.check.kind === 'card_by' && p.check.expect === 'not_done')
  const kairosRight = doubted.filter((p) => p.status === 'right').length
  return { n: doubted.length, ownerRight: doubted.length - kairosRight, kairosRight }
}

function finish(b: Bucket, windowDays: number): TrustArea {
  const calls = metricsFor(b.calls)
  const wentAhead = wentAheadOf(b.calls)
  const right = (calls?.right ?? 0) + b.goals.landed + b.promises.kept
  const n = (calls?.n ?? 0) + b.goals.landed + b.goals.missed + b.promises.kept + b.promises.missed
  const scored = scoreOf(right, n)
  const level = levelFor(scored, calls?.overconfidence ?? 0, wentAhead)
  const area = { key: b.key, kind: b.kind, label: b.label, level, scored, calls, wentAhead, goals: b.goals, promises: b.promises, ideas: b.ideas, corrections7d: b.corrections7d }
  return { ...area, statement: buildTrustStatement(area, windowDays, TRUST_MIN_N) }
}

const hasData = (b: Bucket) =>
  b.calls.length + b.goals.taken + b.goals.vetoed + b.promises.kept + b.promises.missed
  + b.ideas.accepted + b.ideas.dismissed + b.corrections7d > 0

export function computeTrust(inputs: TrustInputs, now: Date, windowDays = TRUST_WINDOW_DAYS): TrustComputed {
  const since = now.getTime() - windowDays * DAY_MS
  const correctionsSince = now.getTime() - CORRECTIONS_WINDOW_DAYS * DAY_MS
  const dominions = new Map<string, Bucket>()
  const topics = new Map<string, Bucket>()
  const dominion = (id: string | null): Bucket | null => {
    if (!id) return null
    const name = inputs.dominionNames.get(id)
    if (name === undefined) return null
    if (!dominions.has(id)) dominions.set(id, emptyBucket(id, 'dominion', name))
    return dominions.get(id)!
  }

  for (const p of inputs.predictions) {
    if ((p.status !== 'right' && p.status !== 'wrong') || !inWindow(p.settledAt ?? p.createdAt, since)) continue
    dominion(p.dominionId)?.calls.push(p)
    const key = topicKey(p.topic)
    if (!topics.has(key)) topics.set(key, emptyBucket(key, 'topic', TOPIC_LABELS[p.topic]))
    topics.get(key)!.calls.push(p)
  }

  const goalsById = new Map(inputs.goals.map((g) => [g.id, g]))
  for (const g of inputs.goals) {
    const { state, decidedAt, closedAt, proposedAt } = g.meta
    const b = dominion(g.dominionId)
    if (!b) continue
    if (TAKEN.has(state) && inWindow(decidedAt ?? proposedAt, since)) b.goals.taken += 1
    if (state === 'vetoed' && inWindow(decidedAt ?? proposedAt, since)) b.goals.vetoed += 1
    if (!inWindow(closedAt ?? decidedAt ?? proposedAt, since)) continue
    if (LANDED.has(state)) b.goals.landed += 1
    if (MISSED.has(state)) b.goals.missed += 1
  }

  for (const pr of inputs.promises) {
    if (pr.status === 'open' || !pr.source.goalId || !inWindow(pr.closedAt ?? pr.createdAt, since)) continue
    const b = dominion(goalsById.get(pr.source.goalId)?.dominionId ?? null)
    if (!b) continue
    if (pr.status === 'kept') b.promises.kept += 1
    else b.promises.missed += 1
  }

  for (const row of inputs.ideaRows) {
    if (row.createdAt.getTime() < since) continue
    const outcome = rowOutcome(row, now)
    if (outcome.by !== 'operator' || (outcome.signal !== 'accepted' && outcome.signal !== 'dismissed')) continue
    const b = dominion(row.dominionId ?? null)
    if (b) b.ideas[outcome.signal] += 1
  }

  let corrections7d = 0
  for (const e of inputs.surpriseEvents) {
    if (e.kind !== 'owner_correction' || !inWindow(e.at, correctionsSince)) continue
    corrections7d += 1
    const b = dominion(e.dominionId)
    if (b) b.corrections7d += 1
  }

  const order = (a: TrustArea, b: TrustArea) => b.scored.n - a.scored.n || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
  const areas = [
    ...[...dominions.values()].filter(hasData).map((b) => finish(b, windowDays)).sort(order),
    ...[...topics.values()].map((b) => finish(b, windowDays)).sort(order),
  ]
  return { windowDays, minN: TRUST_MIN_N, areas, corrections7d }
}

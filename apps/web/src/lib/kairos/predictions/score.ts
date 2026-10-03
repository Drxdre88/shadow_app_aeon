import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'

// Pure scoring over settled predictions: only `right` / `wrong` in the last
// SCORE_WINDOW_DAYS count (void / unresolved are never scored). Metrics are
// shown only once n >= TRACK_RECORD_MIN_N — overall and per breakdown.

export const SCORE_WINDOW_DAYS = 90
export const TRACK_RECORD_MIN_N = 5
const DAY_MS = 24 * 60 * 60 * 1000

export interface ScoreMetrics {
  n: number
  right: number
  hitRate: number
  // Mean (p − o)², o = 1 when right. Lower is better; 0.25 = coin-flip at p 0.5.
  brier: number
  // Mean p − hit rate. Positive = over-confident.
  overconfidence: number
  meanProbability: number
}

export interface TrackRecordScore {
  windowDays: number
  // Settled right/wrong in the window, shown even below the threshold.
  n: number
  // null until n >= TRACK_RECORD_MIN_N.
  overall: ScoreMetrics | null
  byDominion: Array<{ dominionId: string | null } & ScoreMetrics>
  byTopic: Array<{ topic: KairosPrediction['topic'] } & ScoreMetrics>
}

const round = (x: number, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp

export function metricsFor(items: ReadonlyArray<Pick<KairosPrediction, 'probability' | 'status'>>): ScoreMetrics | null {
  const n = items.length
  if (n === 0) return null
  let right = 0
  let sq = 0
  let sumP = 0
  for (const p of items) {
    const o = p.status === 'right' ? 1 : 0
    right += o
    sq += (p.probability - o) ** 2
    sumP += p.probability
  }
  const hitRate = right / n
  const meanProbability = sumP / n
  return { n, right, hitRate: round(hitRate), brier: round(sq / n), overconfidence: round(meanProbability - hitRate), meanProbability: round(meanProbability) }
}

function groupMetrics<K>(items: readonly KairosPrediction[], key: (p: KairosPrediction) => K): Array<{ key: K; metrics: ScoreMetrics }> {
  const groups = new Map<K, KairosPrediction[]>()
  for (const p of items) groups.set(key(p), [...(groups.get(key(p)) ?? []), p])
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, metrics: metricsFor(list) }))
    .filter((g): g is { key: K; metrics: ScoreMetrics } => g.metrics !== null && g.metrics.n >= TRACK_RECORD_MIN_N)
    .sort((a, b) => b.metrics.n - a.metrics.n)
}

export function scorePredictions(settled: readonly KairosPrediction[], now: Date, windowDays = SCORE_WINDOW_DAYS): TrackRecordScore {
  const since = now.getTime() - windowDays * DAY_MS
  const scored = settled.filter((p) =>
    (p.status === 'right' || p.status === 'wrong') && Date.parse(p.settledAt ?? p.createdAt) >= since)
  const n = scored.length
  if (n < TRACK_RECORD_MIN_N) return { windowDays, n, overall: null, byDominion: [], byTopic: [] }
  return {
    windowDays,
    n,
    overall: metricsFor(scored),
    byDominion: groupMetrics(scored, (p) => p.dominionId).map((g) => ({ dominionId: g.key, ...g.metrics })),
    byTopic: groupMetrics(scored, (p) => p.topic).map((g) => ({ topic: g.key, ...g.metrics })),
  }
}

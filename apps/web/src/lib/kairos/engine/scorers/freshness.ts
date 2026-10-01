import type { EngineMemory, Scorer, ScoreContext, ScorerResult } from '../types'

const DAY_MS = 86_400_000

export const FRESHNESS_HALF_LIFE_DAYS: Record<string, number> = {
  agentic: 21,
  execution: 21,
  idea: 30,
  delta: 7,
  snapshot: 7,
  cortex: 30,
  archetype: 30,
  aether: 30,
  concept: 120,
  reflection: 365,
  // Values: a held belief fades over a year; the constitution never fades
  // (retired versions leave via supersede/invalidAt, not via age).
  belief: 365,
  constitution: Number.POSITIVE_INFINITY,
  // Machine output: advisories go stale in weeks, traces in days.
  advisory: 14,
  trace: 7,
}

export const DEFAULT_HALF_LIFE_DAYS = 30

export function halfLifeDays(streamClass: string): number {
  return FRESHNESS_HALF_LIFE_DAYS[streamClass] ?? DEFAULT_HALF_LIFE_DAYS
}

// 1 when brand new (or halfLife is Infinity = never fades), 0.75 at one
// half-life, → 0.5 floor. A non-positive / NaN half-life is treated as the
// default rather than producing NaN.
export function freshnessFactor(ageDays: number, halfLife: number): number {
  if (halfLife === Number.POSITIVE_INFINITY) return 1
  const hl = Number.isFinite(halfLife) && halfLife > 0 ? halfLife : DEFAULT_HALF_LIFE_DAYS
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0
  return 0.5 + 0.5 * Math.pow(2, -age / hl)
}

export function freshnessAnchor(memory: EngineMemory): Date {
  const valid = memory.validAt.getTime()
  const used = memory.lastUsedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  return new Date(Math.max(valid, used))
}

export class FreshnessScorer implements Scorer {
  readonly name = 'freshness'

  score(memory: EngineMemory, ctx: ScoreContext): ScorerResult {
    const ageDays = (ctx.now.getTime() - freshnessAnchor(memory).getTime()) / DAY_MS
    const halfLife = halfLifeDays(memory.streamClass)
    return {
      name: this.name,
      factor: freshnessFactor(ageDays, halfLife),
      note: `age ${Math.max(0, ageDays).toFixed(1)}d / ${Number.isFinite(halfLife) ? `half-life ${halfLife}d` : 'never fades'}`,
    }
  }
}

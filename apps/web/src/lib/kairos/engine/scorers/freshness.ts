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
}

export const DEFAULT_HALF_LIFE_DAYS = 30

export function halfLifeDays(streamClass: string): number {
  return FRESHNESS_HALF_LIFE_DAYS[streamClass] ?? DEFAULT_HALF_LIFE_DAYS
}

export function freshnessFactor(ageDays: number, halfLife: number): number {
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0
  return 0.5 + 0.5 * Math.pow(2, -age / halfLife)
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
      note: `age ${Math.max(0, ageDays).toFixed(1)}d / half-life ${halfLife}d`,
    }
  }
}

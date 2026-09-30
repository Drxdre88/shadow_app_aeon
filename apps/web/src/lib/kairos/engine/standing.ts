import { CONFIDENCE_BY_STREAM, CONFIDENCE_NEUTRAL } from '@/lib/kairos/confidence'
import type { EngineMemory, Scorer, ScoreContext, StandingBreakdown } from './types'

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function isRetired(memory: EngineMemory, now: Date): boolean {
  if (memory.supersededAt || memory.archivedAt) return true
  return memory.invalidAt !== null && memory.invalidAt.getTime() <= now.getTime()
}

export function baseStanding(streamClass: string): number {
  return CONFIDENCE_BY_STREAM[streamClass] ?? CONFIDENCE_NEUTRAL
}

export class Standing {
  constructor(private readonly scorers: readonly Scorer[]) {}

  compute(memory: EngineMemory, ctx: ScoreContext): StandingBreakdown {
    const base = baseStanding(memory.streamClass)
    if (isRetired(memory, ctx.now)) return { standing: 0, base, factors: [] }
    const factors = this.scorers.map((s) => s.score(memory, ctx))
    const product = factors.reduce((acc, f) => acc * f.factor, base)
    return { standing: clamp01(product), base, factors }
  }
}

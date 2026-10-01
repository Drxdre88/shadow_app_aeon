import { countOpenChallenges, updateStandings } from '@/lib/data/memory-engine'
import { loadEngineMemoriesByIds } from '@/lib/data/memory-rescore'
import type { OpLog } from '@/lib/data/memory-ops'
import { Standing } from './engine/standing'
import { defaultScorers } from './engine/scorers'
import type { EngineMemory, MemoryOpInput, StandingBreakdown } from './engine/types'

// Immediate rescore after an operator reaction (docs/kairos/34 §6): the
// touched memories get a fresh Standing now instead of at the next nightly
// weigh. Same rules as the weigh step — a first score writes no op; a move of
// ≥ MIN_DELTA logs a 'score' op (step 'reaction') in the SAME transaction as
// the standing write. Best-effort: never throws.

export const RESCORE_MIN_DELTA = 0.05
const RESCORE_STEP = 'reaction'

export interface RescoreData {
  loadEngineMemoriesByIds(userId: string, ids: readonly string[]): Promise<EngineMemory[]>
  countOpenChallenges(userId: string, ids: readonly string[]): Promise<Map<string, number>>
  updateStandings(
    userId: string,
    updates: ReadonlyArray<{ id: string; standing: number }>,
    at: Date,
    log?: OpLog,
  ): Promise<number>
}

const defaultData: RescoreData = { loadEngineMemoriesByIds, countOpenChallenges, updateStandings }

const round = (n: number) => Math.round(n * 10_000) / 10_000

function describe(b: StandingBreakdown, reason: string): string {
  const factors = b.factors
    .filter((f) => Math.abs(f.factor - 1) > 1e-9)
    .map((f) => `${f.name}×${round(f.factor)}`)
  return [`after ${reason}`, `base ${round(b.base)}`, ...factors].join(' · ')
}

export interface RescoreResult {
  scored: number
  opsWritten: number
}

export async function rescoreMemories(
  userId: string,
  ids: readonly string[],
  reason: string,
  opts: { now?: Date; data?: RescoreData } = {},
): Promise<RescoreResult> {
  const data = opts.data ?? defaultData
  const now = opts.now ?? new Date()
  try {
    const rows = await data.loadEngineMemoriesByIds(userId, ids)
    if (rows.length === 0) return { scored: 0, opsWritten: 0 }
    const challenges = await data.countOpenChallenges(userId, rows.map((m) => m.id))
    const standing = new Standing(defaultScorers())
    const updates: Array<{ id: string; standing: number }> = []
    const ops: MemoryOpInput[] = []
    for (const memory of rows) {
      const breakdown = standing.compute(memory, { now, openChallenges: challenges.get(memory.id) ?? 0 })
      const after = round(breakdown.standing)
      updates.push({ id: memory.id, standing: after })
      // Compare the 4-dp rounded delta: raw float subtraction makes an exact
      // ±0.05 move land at 0.04999… for some standings and skip its op.
      if (memory.standing === null || round(Math.abs(after - memory.standing)) < RESCORE_MIN_DELTA) continue
      ops.push({
        memoryId: memory.id,
        step: RESCORE_STEP,
        op: 'score',
        before: { standing: memory.standing },
        after: { standing: after },
        reason: describe(breakdown, reason),
      })
    }
    // With ops, updateStandings writes standings + ops in ONE transaction.
    await data.updateStandings(userId, updates, now, { runId: null, ops })
    return { scored: updates.length, opsWritten: ops.length }
  } catch (err) {
    console.warn('[kairos-rescore] immediate rescore failed', {
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return { scored: 0, opsWritten: 0 }
  }
}

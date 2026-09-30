import * as engineData from '@/lib/data/memory-engine'
import type { Standing } from '../standing'
import type { EngineMemory, EngineRunContext, Step, StepResult, StandingBreakdown } from '../types'

export interface WeighData {
  loadTouchedEngineMemories(userId: string, since: Date, now: Date, limit: number): Promise<EngineMemory[]>
  loadStalestEngineMemories(userId: string, now: Date, limit: number, excludeIds: readonly string[]): Promise<EngineMemory[]>
  listScoredRetiredMemories(userId: string, now: Date, limit: number): Promise<Array<{ id: string; standing: number }>>
  zeroRetiredStanding(userId: string, now: Date, at: Date): Promise<number>
  countOpenChallenges(userId: string, ids: readonly string[]): Promise<Map<string, number>>
  updateStandings(userId: string, updates: ReadonlyArray<{ id: string; standing: number }>, at: Date): Promise<number>
}

export interface WeighStepOptions {
  cap?: number
  touchedWindowHours?: number
  minDelta?: number
  data?: WeighData
}

const HOUR_MS = 3_600_000
const round = (n: number) => Math.round(n * 10_000) / 10_000

function describe(b: StandingBreakdown): string {
  const factors = b.factors
    .filter((f) => Math.abs(f.factor - 1) > 1e-9)
    .map((f) => `${f.name}×${round(f.factor)}`)
  return [`base ${round(b.base)}`, ...factors].join(' · ')
}

export class WeighStep implements Step {
  readonly name = 'weigh'
  private readonly cap: number
  private readonly windowMs: number
  private readonly minDelta: number
  private readonly data: WeighData

  constructor(private readonly standing: Standing, opts: WeighStepOptions = {}) {
    this.cap = opts.cap ?? 2000
    this.windowMs = (opts.touchedWindowHours ?? 36) * HOUR_MS
    this.minDelta = opts.minDelta ?? 0.05
    this.data = opts.data ?? engineData
  }

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const { userId, now, dryRun, changes } = ctx
    const since = new Date(now.getTime() - this.windowMs)
    const touched = await this.data.loadTouchedEngineMemories(userId, since, now, this.cap)
    const stalest = await this.data.loadStalestEngineMemories(
      userId, now, this.cap - touched.length, touched.map((m) => m.id),
    )
    const rows = [...touched, ...stalest]
    const challenges = await this.data.countOpenChallenges(userId, rows.map((m) => m.id))

    const updates: Array<{ id: string; standing: number }> = []
    let changed = 0
    let firstScored = 0
    for (const memory of rows) {
      const breakdown = this.standing.compute(memory, { now, openChallenges: challenges.get(memory.id) ?? 0 })
      const after = round(breakdown.standing)
      updates.push({ id: memory.id, standing: after })
      if (memory.standing === null) {
        firstScored++
        continue
      }
      if (Math.abs(after - memory.standing) < this.minDelta) continue
      changed++
      changes.record({
        memoryId: memory.id,
        step: this.name,
        op: 'score',
        before: { standing: memory.standing },
        after: { standing: after },
        reason: describe(breakdown),
      })
    }

    const retired = await this.data.listScoredRetiredMemories(userId, now, this.cap)
    for (const r of retired) {
      if (Math.abs(r.standing) < this.minDelta) continue
      changed++
      changes.record({
        memoryId: r.id,
        step: this.name,
        op: 'score',
        before: { standing: r.standing },
        after: { standing: 0 },
        reason: 'retired (superseded, invalid or archived)',
      })
    }

    let zeroed = retired.length
    if (!dryRun) {
      await this.data.updateStandings(userId, updates, now)
      zeroed = await this.data.zeroRetiredStanding(userId, now, now)
    }

    const notes = [
      `scored ${updates.length} (touched ${touched.length}, rolling ${stalest.length})`,
      `first-scored ${firstScored}`,
      `retired zeroed ${zeroed}`,
    ]
    if (dryRun) notes.push('dry run: nothing written')
    return { step: this.name, examined: rows.length + retired.length, changed: changed + firstScored, notes }
  }
}

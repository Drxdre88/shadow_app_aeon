import * as engineData from '@/lib/data/memory-engine'
import type { OpLog } from '@/lib/data/memory-ops'
import { errorMessage, outOfTime } from '../deadline'
import type { Standing } from '../standing'
import type { EngineMemory, EngineRunContext, MemoryOpInput, Step, StepResult, StandingBreakdown } from '../types'

export interface WeighData {
  loadTouchedEngineMemories(userId: string, since: Date, now: Date, limit: number): Promise<EngineMemory[]>
  loadStalestEngineMemories(
    userId: string,
    now: Date,
    limit: number,
    excludeIds: readonly string[],
    rotation?: { night: number; buckets: number },
  ): Promise<EngineMemory[]>
  countLiveEngineMemories(userId: string, now: Date): Promise<number>
  listScoredRetiredMemories(userId: string, now: Date, limit: number): Promise<Array<{ id: string; standing: number }>>
  zeroRetiredStanding(userId: string, now: Date, at: Date): Promise<number>
  countOpenChallenges(userId: string, ids: readonly string[]): Promise<Map<string, number>>
  updateStandings(
    userId: string,
    updates: ReadonlyArray<{ id: string; standing: number }>,
    at: Date,
    log?: OpLog,
  ): Promise<number>
}

export interface WeighStepOptions {
  cap?: number
  touchedWindowHours?: number
  minDelta?: number
  // Rows per standings transaction.
  chunk?: number
  budgetMs?: number
  data?: WeighData
}

// Rows per standings write. Each changed standing is a non-HOT update (every
// index incl. HNSW re-inserted), so keep one statement to a few seconds.
export const WEIGH_WRITE_CHUNK = 100

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
// Target bucket size as a share of the rolling slice (hash-spread headroom).
const ROTATION_FILL = 0.75
const round = (n: number) => Math.round(n * 10_000) / 10_000

function describe(b: StandingBreakdown): string {
  const factors = b.factors
    .filter((f) => Math.abs(f.factor - 1) > 1e-9)
    .map((f) => `${f.name}×${round(f.factor)}`)
  return [`base ${round(b.base)}`, ...factors].join(' · ')
}

export class WeighStep implements Step {
  readonly name = 'weigh'
  readonly budgetMs?: number
  private readonly cap: number
  private readonly windowMs: number
  private readonly minDelta: number
  private readonly chunk: number
  private readonly data: WeighData

  constructor(private readonly standing: Standing, opts: WeighStepOptions = {}) {
    this.cap = opts.cap ?? 2000
    this.windowMs = (opts.touchedWindowHours ?? 36) * HOUR_MS
    this.minDelta = opts.minDelta ?? 0.05
    this.chunk = Math.max(1, opts.chunk ?? WEIGH_WRITE_CHUNK)
    this.budgetMs = opts.budgetMs
    this.data = opts.data ?? engineData
  }

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const { userId, now, dryRun, changes } = ctx
    if (outOfTime(ctx)) return { step: this.name, examined: 0, changed: 0, skipped: 'out of time', outOfTime: true }
    const since = new Date(now.getTime() - this.windowMs)
    const touched = await this.data.loadTouchedEngineMemories(userId, since, now, this.cap)
    const rollingLimit = this.cap - touched.length
    let rotation: { night: number; buckets: number } | undefined
    if (rollingLimit > 0) {
      // Enough buckets that one (≈ live / buckets rows) fits the slice with
      // headroom; every row comes round about once per `buckets` nights.
      const live = await this.data.countLiveEngineMemories(userId, now)
      rotation = {
        night: Math.floor(now.getTime() / DAY_MS),
        buckets: Math.max(1, Math.ceil(live / (rollingLimit * ROTATION_FILL))),
      }
    }
    const stalest = await this.data.loadStalestEngineMemories(
      userId, now, rollingLimit, touched.map((m) => m.id), rotation,
    )
    const rows = [...touched, ...stalest]
    const challenges = await this.data.countOpenChallenges(userId, rows.map((m) => m.id))

    // A standing is written only when it moved ≥ minDelta from the STORED
    // value, and then always with its 'score' op — so every write is
    // revertable. Smaller moves are held (not written); they accumulate
    // against the stored value and are written once they cross minDelta.
    // A first score (stored NULL) is written without an op: nothing to revert to.
    const updates: Array<{ id: string; standing: number }> = []
    const ops: MemoryOpInput[] = []
    let firstScored = 0
    let held = 0
    let touchedUpdates = 0
    rows.forEach((memory, i) => {
      if (i === touched.length) touchedUpdates = updates.length
      const breakdown = this.standing.compute(memory, { now, openChallenges: challenges.get(memory.id) ?? 0 })
      const after = round(breakdown.standing)
      if (memory.standing === null) {
        updates.push({ id: memory.id, standing: after })
        firstScored++
        return
      }
      // Round the delta so a float artefact (0.0499…) can't hide a 0.05 move.
      if (Math.round(Math.abs(after - memory.standing) * 1e4) / 1e4 < this.minDelta) {
        held++
        return
      }
      updates.push({ id: memory.id, standing: after })
      ops.push({
        memoryId: memory.id,
        step: this.name,
        op: 'score',
        before: { standing: memory.standing },
        after: { standing: after },
        reason: describe(breakdown),
      })
    })
    if (rows.length === touched.length) touchedUpdates = updates.length

    // Every scored retired row is zeroed with its op (however small its
    // standing: one left non-zero would be re-listed every night); never-
    // scored retired rows get 0 without an op.
    // Order = write priority if the step's time runs out: touched rows, then
    // retired zeroes, then the rolling slice (unwritten rows are re-examined
    // when their bucket comes round).
    const retired = await this.data.listScoredRetiredMemories(userId, now, this.cap)
    const retiredUpdates: Array<{ id: string; standing: number }> = []
    for (const r of retired) {
      retiredUpdates.push({ id: r.id, standing: 0 })
      ops.push({
        memoryId: r.id,
        step: this.name,
        op: 'score',
        before: { standing: r.standing },
        after: { standing: 0 },
        reason: 'retired (superseded, invalid or archived)',
      })
    }
    updates.splice(touchedUpdates, 0, ...retiredUpdates)

    let zeroed = 0
    let opsWritten = 0
    let written = 0
    let stopped = false
    const errors: string[] = []
    if (dryRun) {
      for (const op of ops) changes.record(op)
      zeroed = retired.length
    } else {
      // Each chunk's standings + its score ops commit in ONE transaction, so a
      // chunk lands whole with its trail or not at all. Small chunks keep each
      // UPDATE well inside the 15s query timeout: a standing change is a
      // non-HOT update (memories_standing_idx), re-inserting the row into
      // every index incl. the HNSW embedding index — 500-row statements in one
      // run-long transaction timed out on 2026-10-02 and rolled back the lot.
      const opsById = new Map<string, MemoryOpInput[]>()
      for (const op of ops) if (op.memoryId) opsById.set(op.memoryId, [...(opsById.get(op.memoryId) ?? []), op])
      const retiredIds = new Set(retired.map((r) => r.id))
      for (let i = 0; i < updates.length; i += this.chunk) {
        if (outOfTime(ctx)) {
          stopped = true
          break
        }
        const chunk = updates.slice(i, i + this.chunk)
        const chunkOps = chunk.flatMap((u) => opsById.get(u.id) ?? [])
        try {
          await this.data.updateStandings(userId, chunk, now, { runId: ctx.runId, ops: chunkOps })
        } catch (err) {
          // Rolled back with its ops. Stop here: the next chunk would most
          // likely time out the same way; unwritten rows carry over.
          errors.push(`standings ${i + 1}-${i + chunk.length} of ${updates.length}: ${errorMessage(err)}`)
          break
        }
        written += chunk.length
        opsWritten += chunkOps.length
        zeroed += chunk.filter((u) => retiredIds.has(u.id)).length
      }
      if (!stopped && errors.length === 0) {
        if (outOfTime(ctx)) stopped = true
        else zeroed += await this.data.zeroRetiredStanding(userId, now, now)
      }
    }

    const notes = [
      `examined ${rows.length} (touched ${touched.length}, rolling ${stalest.length}${rotation ? `, bucket ${rotation.night % rotation.buckets}/${rotation.buckets}` : ''})`,
      `rescored ${updates.length - retired.length - firstScored}`,
      `held ${held} (|Δ| < ${this.minDelta})`,
      `first-scored ${firstScored}`,
      `retired zeroed ${zeroed}`,
    ]
    if (dryRun) notes.push('dry run: nothing written')
    else if (written < updates.length) notes.push(`wrote ${written}/${updates.length} standings`)
    if (errors.length) notes.push(`failed=${errors.length}`)
    if (stopped) notes.push(`out of time after ${written}/${updates.length}`)
    return {
      step: this.name,
      examined: rows.length + retired.length,
      changed: ops.length + firstScored,
      notes,
      ...(dryRun ? {} : { opsWritten }),
      ...(errors.length ? { errors } : {}),
      ...(stopped ? { outOfTime: true } : {}),
    }
  }
}

import { randomUUID } from 'node:crypto'
import { errorMessage, outOfTime } from './deadline'
import type { ChangeLog, EngineRunContext, EngineRunResult, Step, StepResult } from './types'

export type ChangeLogFactory = (userId: string, runId: string) => ChangeLog

export interface MemoryEngineOptions {
  steps: readonly Step[]
  changes: ChangeLogFactory
  clock?: () => Date
  newRunId?: () => string
}

export class MemoryEngine {
  private readonly steps: readonly Step[]
  private readonly changes: ChangeLogFactory
  private readonly clock: () => Date
  private readonly newRunId: () => string

  constructor(opts: MemoryEngineOptions) {
    this.steps = opts.steps
    this.changes = opts.changes
    this.clock = opts.clock ?? (() => new Date())
    this.newRunId = opts.newRunId ?? randomUUID
  }

  // `deadline` (epoch ms): steps stop starting new mutations past it and the
  // remaining steps are skipped, so the caller can still write its trace.
  async runNight(userId: string, opts: { dryRun?: boolean; deadline?: number } = {}): Promise<EngineRunResult> {
    const dryRun = opts.dryRun ?? false
    const runId = this.newRunId()
    const changes = this.changes(userId, runId)
    const ctx: EngineRunContext = { userId, runId, now: this.clock(), dryRun, changes, deadline: opts.deadline }
    const steps: StepResult[] = []
    const failedSteps: EngineRunResult['failedSteps'] = []

    let opsWritten = 0
    let stoppedEarly = false
    for (const step of this.steps) {
      if (outOfTime(ctx)) {
        stoppedEarly = true
        steps.push({ step: step.name, examined: 0, changed: 0, skipped: 'out of time', outOfTime: true })
        continue
      }
      try {
        const result = await step.run(ctx)
        steps.push(result)
        opsWritten += result.opsWritten ?? 0
        if (result.outOfTime) stoppedEarly = true
        if (result.errors?.length) {
          const shown = result.errors.slice(0, 3).join('; ')
          const more = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''
          failedSteps.push({ step: step.name, error: `${result.errors.length} change(s) rolled back: ${shown}${more}` })
        }
      } catch (err) {
        // Live steps write each change with its op in one transaction, so a
        // throw here never strands a write without its memory_ops row.
        failedSteps.push({ step: step.name, error: errorMessage(err) })
      }
      if (dryRun) continue
      // Live steps must never buffer: the buffer is the dry-run report. Any op
      // recorded on a live run was written outside its mutation's transaction
      // — persist it as a last resort and flag the step.
      const stray = changes.pending().length
      if (stray === 0) continue
      try {
        opsWritten += await changes.flush()
        failedSteps.push({ step: `changelog:${step.name}`, error: `${stray} op(s) recorded outside their write transaction` })
      } catch (err) {
        failedSteps.push({ step: `changelog:${step.name}`, error: errorMessage(err) })
      }
    }

    return {
      runId,
      userId,
      dryRun,
      steps,
      opsWritten,
      ...(dryRun ? { opsPlanned: changes.pending().length } : {}),
      ...(stoppedEarly ? { outOfTime: true } : {}),
      failedSteps,
    }
  }
}

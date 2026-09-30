import { randomUUID } from 'node:crypto'
import type { ChangeLog, EngineRunResult, Step, StepResult } from './types'

export type ChangeLogFactory = (userId: string, runId: string) => ChangeLog

export interface MemoryEngineOptions {
  steps: readonly Step[]
  changes: ChangeLogFactory
  clock?: () => Date
  newRunId?: () => string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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

  async runNight(userId: string, opts: { dryRun?: boolean } = {}): Promise<EngineRunResult> {
    const dryRun = opts.dryRun ?? false
    const runId = this.newRunId()
    const changes = this.changes(userId, runId)
    const ctx = { userId, runId, now: this.clock(), dryRun, changes }
    const steps: StepResult[] = []
    const failedSteps: EngineRunResult['failedSteps'] = []

    let opsWritten = 0
    for (const step of this.steps) {
      try {
        steps.push(await step.run(ctx))
      } catch (err) {
        failedSteps.push({ step: step.name, error: errorMessage(err) })
      }
      // Flush after every step (even a failed one: its writes before the throw
      // landed), so a function timeout mid-run never strands already-applied
      // writes without their memory_ops trail. A failed flush keeps the ops
      // buffered for the next step's flush and never stops later steps.
      if (dryRun) continue
      try {
        opsWritten += await changes.flush()
      } catch (err) {
        failedSteps.push({ step: `changelog:${step.name}`, error: errorMessage(err) })
      }
    }

    return { runId, userId, dryRun, steps, opsWritten, failedSteps }
  }
}

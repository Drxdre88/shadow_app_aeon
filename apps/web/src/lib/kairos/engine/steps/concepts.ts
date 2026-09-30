import type { EngineRunContext, Step, StepResult, ThinkingJobHandler, ThinkingJobSpec } from '../types'
import { CONCEPT_STEP, MAX_CONCEPTS_PER_WEEK, conceptHandler, isConceptDay } from '@/lib/kairos/thinking/handlers/concept'

// Memory engine step 4 — Concepts (docs/kairos/32 §2.4). Weekly (Sunday UTC).
// Plan + enqueue ONLY: one thinking job per cluster for the routine to answer.
// Never calls a model here — the nightly cron's time budget is shared with
// every other step, and the thinking-queue sweep owns the API fallback for
// jobs the routine does not answer. The handler writes each concept and its
// memory_ops row atomically, so this step records nothing into ctx.changes.

export type EnqueueThinkingJobs = (userId: string, specs: readonly ThinkingJobSpec[]) => Promise<number>

export interface ConceptStepOptions {
  enqueue: EnqueueThinkingJobs
  handler?: Pick<ThinkingJobHandler, 'plan'>
  maxPerRun?: number
}

export class ConceptStep implements Step {
  readonly name = CONCEPT_STEP
  private readonly handler: Pick<ThinkingJobHandler, 'plan'>
  private readonly enqueue: EnqueueThinkingJobs
  private readonly maxPerRun: number

  constructor(opts: ConceptStepOptions) {
    this.handler = opts.handler ?? conceptHandler
    this.enqueue = opts.enqueue
    this.maxPerRun = opts.maxPerRun ?? MAX_CONCEPTS_PER_WEEK
  }

  async run(ctx: EngineRunContext): Promise<StepResult> {
    if (!isConceptDay(ctx.now)) return { step: this.name, examined: 0, changed: 0, skipped: 'not sunday' }

    const specs = (await this.handler.plan(ctx.userId, ctx.now)).slice(0, this.maxPerRun)
    if (specs.length === 0) return { step: this.name, examined: 0, changed: 0, notes: ['no new or changed clusters'] }
    if (ctx.dryRun) {
      return { step: this.name, examined: specs.length, changed: 0, notes: specs.map((s) => `plan ${s.externalKey}`) }
    }

    const queued = await this.enqueue(ctx.userId, specs)
    return { step: this.name, examined: specs.length, changed: 0, notes: [`enqueued ${queued} concept jobs`] }
  }
}

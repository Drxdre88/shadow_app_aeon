import { mirrorPromotionsToOwnMind } from '@/lib/kairos/beliefs/mirror'
import { outOfTime } from '../deadline'
import type { EngineRunContext, Step, StepResult } from '../types'

// OwnMind (docs/kairos/34 §1): right after BackUp, mirror the run's (and any
// missed) engine promotions into held own-mind beliefs and retire mirrors of
// reverted promotions. No model call; idempotent per promotion, so the
// lookback overlap is free and a missed night self-heals. Each write commits
// with its memory_ops row (tagged with this run); per-write failures surface
// as step errors in the run's failedSteps / cron trace.

export const OWN_MIND_LOOKBACK_DAYS = 14
const DAY_MS = 86_400_000

export class OwnMindStep implements Step {
  readonly name = 'own_mind'

  constructor(private readonly opts: { lookbackDays?: number; mirror?: typeof mirrorPromotionsToOwnMind } = {}) {}

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const mirror = this.opts.mirror ?? mirrorPromotionsToOwnMind
    const since = new Date(ctx.now.getTime() - (this.opts.lookbackDays ?? OWN_MIND_LOOKBACK_DAYS) * DAY_MS)
    const res = await mirror(ctx.userId, since, {
      runId: ctx.runId,
      now: ctx.now,
      dryRun: ctx.dryRun,
      stop: () => outOfTime(ctx),
    })
    for (const op of res.planned) ctx.changes.record(op)

    const written = res.mirrored.length + res.retired.length
    const notes = ctx.dryRun
      ? [`would write ${res.planned.length} op(s)`]
      : [`mirrored=${res.mirrored.length}`, `retired=${res.retired.length}`]
    if (res.errors.length) notes.push(`failed=${res.errors.length}`)
    if (res.stopped) notes.push(`out of time after ${written + res.errors.length}/${res.examined}`)
    return {
      step: this.name,
      examined: res.examined,
      changed: ctx.dryRun ? res.planned.length : written,
      notes,
      ...(ctx.dryRun ? {} : { opsWritten: written }),
      ...(res.errors.length ? { errors: res.errors } : {}),
      ...(res.stopped ? { outOfTime: true } : {}),
    }
  }
}

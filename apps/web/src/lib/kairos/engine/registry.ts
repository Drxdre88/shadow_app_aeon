import { upsertJob } from '@/lib/data/thinking-jobs'
import { Standing } from './standing'
import { defaultScorers } from './scorers'
import { BackUpStep } from './steps/back-up'
import { ConceptStep } from './steps/concepts'
import { MergeStep } from './steps/merge'
import { OwnMindStep } from './steps/own-mind'
import { RecheckStep } from './steps/recheck'
import { WeighStep } from './steps/weigh'
import type { Step, ThinkingJobSpec } from './types'

async function enqueueThinkingJobs(userId: string, specs: readonly ThinkingJobSpec[]): Promise<number> {
  let queued = 0
  for (const spec of specs) {
    if (await upsertJob(userId, spec)) queued++
  }
  return queued
}

// Night order (docs/kairos/32 §2): fold repeats first so Weigh scores the
// survivors; then the cheap belief steps — mirror promotions into the own mind
// and re-check beliefs whose support went away — BEFORE BackUp, which is the
// slow step (one transaction + support query per candidate) and can exhaust the
// run's time budget while a proposal backlog drains. A promotion BackUp makes
// tonight is mirrored the next night (OwnMind looks back 14 days). Weekly
// concepts last.
//
// Time slices (route budget 230s): Merge and Weigh are capped so neither can
// starve the steps after them; BackUp drains what is left, minus the time
// Concepts reserves on Sundays. A step that hits its slice yields; its
// backlog (oldest first) carries over to the next night.
export const MERGE_BUDGET_MS = 50_000
export const WEIGH_BUDGET_MS = 70_000

export function buildNightSteps(): Step[] {
  return [
    new MergeStep({ budgetMs: MERGE_BUDGET_MS }),
    new WeighStep(new Standing(defaultScorers()), { budgetMs: WEIGH_BUDGET_MS }),
    new OwnMindStep(),
    new RecheckStep(),
    new BackUpStep(),
    new ConceptStep({ enqueue: enqueueThinkingJobs }),
  ]
}

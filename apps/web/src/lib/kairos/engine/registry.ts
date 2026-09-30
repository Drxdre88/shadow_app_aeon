import { upsertJob } from '@/lib/data/thinking-jobs'
import { Standing } from './standing'
import { defaultScorers } from './scorers'
import { BackUpStep } from './steps/back-up'
import { ConceptStep } from './steps/concepts'
import { MergeStep } from './steps/merge'
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
// survivors, promote/decay candidates on fresh standing, then weekly concepts.
export function buildNightSteps(): Step[] {
  return [
    new MergeStep(),
    new WeighStep(new Standing(defaultScorers())),
    new BackUpStep(),
    new ConceptStep({ enqueue: enqueueThinkingJobs }),
  ]
}

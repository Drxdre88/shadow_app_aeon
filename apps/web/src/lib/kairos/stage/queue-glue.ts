import { mergeJobOutput } from '@/lib/data/thinking-jobs'
import type { ApplyOutcome, ThinkingJobRow } from '@/lib/kairos/engine/types'
import { STAGE_DEEP_ONLY_KINDS, queueInjectsStage, stageMode } from './flag'
import { loadStageBlock, postStageCandidates } from './index'
import { prependStageBlock } from './render'

// ─────────────────────────────────────────────────────────────────────────
// The thinking queue's three stage touch points (spec_stage §2, §5), kept
// here so queue.ts stays small. With KAIROS_STAGE off every helper returns
// its input untouched — no read, no write, byte-identical prompts and output.
// ─────────────────────────────────────────────────────────────────────────

export interface StageLineage {
  cycle: string
  given: string[]
}

function lineageOf(output: Record<string, unknown> | null): Partial<StageLineage> | undefined {
  const stage = output?.stage
  return stage && typeof stage === 'object' && !Array.isArray(stage) ? (stage as Partial<StageLineage>) : undefined
}

// Routine claim: the prompt to serve. Prepends the block (never the system
// prompt) and stamps lineage on the job so submit can apply the echo rule.
export async function stagePromptForClaim(userId: string, job: ThinkingJobRow): Promise<string> {
  const prompt = job.input.prompt
  if (stageMode() !== 'on' || !queueInjectsStage(job.kind)) return prompt
  const { block, given, cycle } = await loadStageBlock(userId, { deepOnly: STAGE_DEEP_ONLY_KINDS.includes(job.kind) })
  if (!block) return prompt
  try {
    await mergeJobOutput(userId, job.id, { stage: { cycle, given } })
  } catch (err) {
    console.error(`[kairos:stage] lineage stamp failed for ${job.id}:`, err)
  }
  return prependStageBlock(block, prompt)
}

// Sweep fallback: the same injection, in memory only (the stored input is
// never rewritten). `inject` = the sweep runs a real model call for this kind.
export async function stageJobForFallback(
  job: ThinkingJobRow,
  inject: boolean,
): Promise<{ job: ThinkingJobRow; lineage?: StageLineage }> {
  if (!inject || stageMode() !== 'on' || !queueInjectsStage(job.kind)) return { job }
  const { block, given, cycle } = await loadStageBlock(job.userId, { deepOnly: STAGE_DEEP_ONLY_KINDS.includes(job.kind) })
  if (!block) return { job }
  return { job: { ...job, input: { ...job.input, prompt: prependStageBlock(block, job.input.prompt) } }, lineage: { cycle, given } }
}

// After a successful apply/fallback: post the outcome's thoughts (never
// throws) and return the `stage` key to keep on the job's output, which
// completeJob/recordFallback replace wholesale. undefined when the flag is off.
export async function stageAfterApply(
  userId: string,
  job: ThinkingJobRow,
  outcome: Extract<ApplyOutcome, { ok: true }>,
  lineage?: StageLineage,
): Promise<Record<string, unknown> | undefined> {
  if (stageMode() === 'off') return undefined
  const prior = lineage ?? lineageOf(job.output)
  const thoughts = outcome.thoughts ?? []
  const res = thoughts.length > 0 ? await postStageCandidates(userId, job, thoughts, { given: prior?.given }) : null
  return { ...(prior ?? {}), posted: res?.posted ?? 0, merged: res?.merged ?? 0 }
}

// The ok outcome with its stage key folded into `output` (recordFallback).
export function withStageOutput<T extends ApplyOutcome>(outcome: T, stage: Record<string, unknown> | undefined): T {
  if (!stage || !outcome.ok) return outcome
  return { ...outcome, output: { ...(outcome.output ?? {}), stage } }
}

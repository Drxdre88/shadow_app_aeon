import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { stageMode, stageSurpriseThreshold } from './flag'
import { gatherAmbient } from './ambient'
import { renderStageBlock } from './render'
import { applyStagePost, londonCycleKey, stageNeedsRollover, stageTierForKind, surpriseSince } from './select'
import type { StageBlock, StageCandidateInput, StagePost, StagePostResult } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos stage — the global workspace (spec_stage). Producers post thoughts
// after a job applies; a plain-code selector keeps a small pool of
// coalitions; readers get a ≤400-char block in their PROMPT (never the
// system prompt — it is prompt-cached). KAIROS_STAGE gates everything.
//
// The DB-touching modules are imported lazily so importing this barrel never
// pulls in the database client (pure prompt builders and their tests import
// it freely).
// ─────────────────────────────────────────────────────────────────────────

export type { StageCandidateInput, StageMode, StageBlock, StagePostResult } from './types'
export {
  stageMode,
  STAGE_READER_KINDS,
  STAGE_SELF_INJECTED_KINDS,
  STAGE_DEEP_ONLY_KINDS,
  queueInjectsStage,
} from './flag'
export { parseStageItems, sanitiseStageText } from './normalise'
export { renderStageBlock, prependStageBlock, STAGE_BLOCK_MAX_CHARS } from './render'

const log = (what: string, err: unknown) => console.error(`[kairos:stage] ${what} failed:`, err)

// The stage block for a reader. Never throws; '' unless KAIROS_STAGE=1.
export async function loadStageBlock(
  userId: string,
  opts: { now?: Date; deepOnly?: boolean; maxChars?: number } = {},
): Promise<StageBlock> {
  const now = opts.now ?? new Date()
  const empty: StageBlock = { block: '', given: [], cycle: londonCycleKey(now) }
  if (stageMode() !== 'on') return empty
  try {
    const { readKairosStage } = await import('@/lib/data/kairos-stage')
    const state = await readKairosStage(userId)
    return renderStageBlock(state, { now, deepOnly: opts.deepOnly, maxChars: opts.maxChars })
  } catch (err) {
    log('loadStageBlock', err)
    return empty
  }
}

// Early-reflect trigger: Σ surprise posted since `since` reached
// KAIROS_STAGE_SURPRISE_THRESHOLD (default 1.2). false unless KAIROS_STAGE=1.
export async function stageSurpriseDue(userId: string, since: Date, now: Date = new Date()): Promise<boolean> {
  if (stageMode() !== 'on') return false
  try {
    const { readKairosStage } = await import('@/lib/data/kairos-stage')
    return surpriseSince(await readKairosStage(userId), since, now) >= stageSurpriseThreshold()
  } catch (err) {
    log('stageSurpriseDue', err)
    return false
  }
}

export function stageGivenOf(output: Record<string, unknown> | null | undefined): string[] | undefined {
  const stage = output?.stage
  if (!stage || typeof stage !== 'object') return undefined
  const given = (stage as Record<string, unknown>).given
  return Array.isArray(given) ? given.filter((g): g is string => typeof g === 'string') : undefined
}

// Queue-only. Post one applied job's thoughts (plus ambient facts on cycle
// rollover) to the selector. Never throws — the stage must never fail a job.
// Re-posting the same job is a no-op.
export async function postStageCandidates(
  userId: string,
  job: Pick<ThinkingJobRow, 'id' | 'kind' | 'output'>,
  thoughts: readonly StageCandidateInput[],
  opts: { now?: Date; given?: string[] } = {},
): Promise<StagePostResult> {
  const none: StagePostResult = { posted: 0, merged: 0, echoed: 0, ambient: 0, dropped: 0 }
  if (stageMode() === 'off') return { ...none, skipped: 'off' }
  try {
    const now = opts.now ?? new Date()
    const { readKairosStage, mutateKairosStage } = await import('@/lib/data/kairos-stage')
    // Reads happen before the locked transaction (Neon pool acquire is 8s).
    const current = await readKairosStage(userId)
    if (current.postedJobs.includes(job.id)) return { ...none, skipped: 'duplicate_job' }
    const ambient = stageNeedsRollover(current, now) ? await gatherAmbient(userId, now) : []
    const post: StagePost = {
      kind: job.kind,
      source: 'job',
      tier: stageTierForKind(job.kind),
      jobId: job.id,
      given: opts.given ?? stageGivenOf(job.output),
      items: [...thoughts],
    }
    return await mutateKairosStage(userId, (s) => applyStagePost(s, { post, ambient }, now))
  } catch (err) {
    log('postStageCandidates', err)
    return { ...none, skipped: 'error' }
  }
}

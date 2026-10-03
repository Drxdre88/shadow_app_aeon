import type { ApplyOutcome, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { buildJudgeSpec, contenders, readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { IDEA_GENERATE_KIND } from '@/lib/kairos/ideas/types'
import { centralCandidates } from './measure'
import { withUsualPattern } from './prompt'

// Lane C resample: at most one extra idea_generate job per night, of the
// SAME kind, keyed idea_generate:<day>:resample. It reuses the first job's
// system prompt and inputs, adds "your usual pattern — avoid it", and never
// resamples itself. When it fails, the first batch (held back on the base
// job's output as deferredJudgeContext) is judged instead — no model call.

// Mirrors IDEA_GENERATE_DEADLINE_MINUTES (handlers/idea-generate.ts) without importing the handler.
export const RESAMPLE_DEADLINE_MINUTES = 55
const BASE_LOOKUP_LIMIT = 10
const DONE_STATUSES = new Set(['done', 'fallback'])
const OPEN_STATUSES = new Set(['queued', 'claimed'])

export const baseGenerateKey = (day: string) => `${IDEA_GENERATE_KIND}:${day}`
export const resampleJobKey = (day: string) => `${baseGenerateKey(day)}:resample`

// Lazy: keeps the idea-ext registry free of DB imports at module load.
const jobsStore = () => import('@/lib/data/thinking-jobs')

const contextOf = (job: ThinkingJobRow): Record<string, unknown> =>
  (job.input?.context && typeof job.input.context === 'object' ? job.input.context : {}) as Record<string, unknown>

export function isResampleJob(job: ThinkingJobRow): boolean {
  return job.externalKey.endsWith(':resample') || typeof contextOf(job).resampleOf === 'string'
}

export function buildResampleSpec(job: ThinkingJobRow, judge: IdeaJudgeContext): ThinkingJobSpec {
  return {
    kind: IDEA_GENERATE_KIND,
    dominionId: null,
    externalKey: resampleJobKey(judge.date),
    deadlineMinutes: RESAMPLE_DEADLINE_MINUTES,
    input: {
      system: job.input.system,
      prompt: withUsualPattern(job.input.prompt, centralCandidates(judge.candidates)),
      validMemoryIds: job.input.validMemoryIds ?? [],
      context: { ...contextOf(job), resampleOf: job.id },
      ...(job.input.maxOutputTokens !== undefined ? { maxOutputTokens: job.input.maxOutputTokens } : {}),
    },
  }
}

// Upserts tonight's resample job; null when it already existed.
export async function planResample(job: ThinkingJobRow, judge: IdeaJudgeContext): Promise<ThinkingJobRow | null> {
  const { upsertJob } = await jobsStore()
  return upsertJob(job.userId, buildResampleSpec(job, judge))
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160)

// The resample job could not answer: judge the held-back first batch. Never throws.
export async function settleResample(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const baseId = contextOf(job).resampleOf
  try {
    const { listJobs, upsertJob } = await jobsStore()
    const jobs = await listJobs(job.userId, { kind: IDEA_GENERATE_KIND, limit: BASE_LOOKUP_LIMIT })
    const base = jobs.find((j) => j.id === baseId)
    const ctx = readJudgeContext(base?.output?.deferredJudgeContext)
    if (!base || !ctx) return { ok: false, reason: 'resample: the first batch is missing' }
    if (contenders(ctx).length === 0) {
      // Lazy: the apply module imports the idea-ext registry, which imports this file.
      const { endNightEarly } = await import('@/lib/kairos/thinking/handlers/idea-generate-apply')
      const memoryIds = await endNightEarly(base, ctx, 'no_novel_candidates')
      return { ok: true, memoryIds, output: { resampleOf: baseId, settled: 'no_contenders', judgeJobId: null } }
    }
    const row = await upsertJob(job.userId, buildJudgeSpec(ctx))
    return { ok: true, memoryIds: [], output: { resampleOf: baseId, settled: 'first_batch', judgeJobId: row?.id ?? null } }
  } catch (err) {
    return { ok: false, reason: `resample: settle failed: ${reason(err)}` }
  }
}

// Judge recovery: undefined = no resample tonight (base behaviour); null = wait / nothing to judge.
export function recoveryJudgeContext(jobs: readonly ThinkingJobRow[], day: string): unknown {
  const resample = jobs.find((j) => j.externalKey === resampleJobKey(day))
  if (!resample) return undefined
  if (OPEN_STATUSES.has(resample.status)) return null
  const out = resample.output ?? {}
  if (DONE_STATUSES.has(resample.status) && out.judgeContext !== undefined) return out.judgeContext
  if (DONE_STATUSES.has(resample.status) && out.ended !== undefined) return null
  const base = jobs.find((j) => j.externalKey === baseGenerateKey(day))
  return base?.output?.deferredJudgeContext ?? null
}

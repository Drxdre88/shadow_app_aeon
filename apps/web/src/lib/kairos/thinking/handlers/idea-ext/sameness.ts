import type { IdeaParseOptions } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { ideaResampleMode, ideaVsEnabled, samenessDistance } from '@/lib/kairos/ideas/sameness/flag'
import { TAIL_P, batchSameness, keepTail, readLens, readLikelihood, tooSimilar, type BatchSameness } from '@/lib/kairos/ideas/sameness/measure'
import { lensNames, withLenses, withVerbalizedSampling, type IdeaLens } from '@/lib/kairos/ideas/sameness/prompt'
import { isResampleJob, planResample, recoveryJudgeContext, settleResample } from '@/lib/kairos/ideas/sameness/resample'
import type { IdeaCandidate } from '@/lib/kairos/ideas/types'
import { errorReason } from '../_errors'
import type { GenerateHookContext, IdeaExtension, JobContext } from './types'

// Lane C (anti-sameness) idea-tournament hooks. KAIROS_IDEA_VS: verbalized
// sampling + archetype lenses inside the ONE generate call, keep-the-tail
// parse. KAIROS_IDEA_RESAMPLE: measure batch sameness (observe) or, for a
// routine-answered night that is too similar, hold the judge back and plan
// one resample job (1). Incubation lives in handlers/pulse.ts.

interface SamenessScratch {
  stats: BatchSameness
  threshold: number
  tooSimilar: boolean
  resampleJobId?: string | null
}

const SCRATCH = 'sameness'
const MIN_LENSES = 2

const isVs = (jobContext: JobContext) => jobContext.vs === true

function contextLenses(jobContext: JobContext): string[] {
  const raw = jobContext.lenses
  return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string') : []
}

function measure(judge: IdeaJudgeContext, ctx: GenerateHookContext): SamenessScratch {
  const cached = ctx.scratch[SCRATCH] as SamenessScratch | undefined
  if (cached) return cached
  const stats = batchSameness(judge.candidates)
  const threshold = samenessDistance()
  const out: SamenessScratch = { stats, threshold, tooSimilar: tooSimilar(stats, threshold) }
  ctx.scratch[SCRATCH] = out
  return out
}

function vsSummary(judge: IdeaJudgeContext): Record<string, unknown> {
  const stated = judge.candidates.filter((c) => typeof c.likelihood === 'number')
  const lenses: Record<string, number> = {}
  for (const c of judge.candidates) if (c.lens) lenses[c.lens] = (lenses[c.lens] ?? 0) + 1
  return { stated: stated.length, tail: stated.filter((c) => (c.likelihood as number) < TAIL_P).length, lenses }
}

function parseOptions(jobContext: JobContext): IdeaParseOptions {
  if (!isVs(jobContext)) return {}
  const names = contextLenses(jobContext)
  return {
    extendCandidate: (rawItem, built) => {
      const item = rawItem && typeof rawItem === 'object' ? (rawItem as Record<string, unknown>) : {}
      const likelihood = readLikelihood(item.p)
      const out: IdeaCandidate = { ...built }
      if (likelihood !== undefined) out.likelihood = likelihood
      if (names.length > 0) out.lens = readLens(item.lens, names)
      return out
    },
    postProcess: (candidates) => keepTail(candidates),
    skipCap: true,
  }
}

export const samenessExtension: IdeaExtension = {
  async planGenerate(draft, ctx) {
    if (!ideaVsEnabled()) return draft
    let lenses: IdeaLens[] = []
    try {
      const { listArchetypeLenses } = await import('@/lib/data/idea-lenses')
      const rows = await listArchetypeLenses(ctx.userId, ctx.dominions.map((d) => d.id))
      lenses = rows.map((r) => ({ name: r.title, summary: r.summary }))
    } catch (err) {
      ctx.errors.push(`lenses: ${errorReason(err)}`.slice(0, 200))
    }
    const names = lensNames(lenses)
    const useLenses = names.length >= MIN_LENSES
    return {
      ...draft,
      system: withVerbalizedSampling(draft.system, useLenses),
      prompt: useLenses ? withLenses(draft.prompt, lenses) : draft.prompt,
      context: { ...draft.context, vs: true, ...(useLenses ? { lenses: names } : {}) },
    }
  },

  parseOptions,

  enrichStoredCandidate(stored, candidate, ctx) {
    if (!isVs(ctx.jobContext)) return stored
    return {
      ...stored,
      ...(candidate.likelihood !== undefined ? { likelihood: candidate.likelihood } : {}),
      ...(candidate.lens !== undefined ? { lens: candidate.lens } : {}),
    }
  },

  async beforePlanJudge(judge, ctx) {
    if (ideaResampleMode() !== 'on' || ctx.answeredBy !== 'routine' || isResampleJob(ctx.job)) return null
    const m = measure(judge, ctx)
    if (!m.tooSimilar) return null
    const row = await planResample(ctx.job, judge)
    m.resampleJobId = row?.id ?? null
    return { output: { deferredJudgeContext: judge, resampleJobId: m.resampleJobId, judgeJobId: null } }
  },

  summarizeGenerate(judge, ctx) {
    const vs = isVs(ctx.jobContext) ? { vs: vsSummary(judge) } : null
    if (ideaResampleMode() === 'off') return vs
    const m = measure(judge, ctx)
    const resampleOf = typeof ctx.jobContext.resampleOf === 'string' ? ctx.jobContext.resampleOf : undefined
    return {
      ...vs,
      sameness: {
        ...m.stats,
        threshold: m.threshold,
        tooSimilar: m.tooSimilar,
        ...(m.resampleJobId !== undefined ? { resampleJobId: m.resampleJobId } : {}),
        ...(resampleOf ? { resampleOf } : {}),
      },
    }
  },

  async fallbackGenerate(job) {
    return isResampleJob(job) ? settleResample(job) : null
  },

  async abandonGenerate(job, reason) {
    if (!isResampleJob(job)) return null
    const out = await settleResample(job)
    if (!out.ok) console.warn('[kairos:idea-resample] abandon could not settle:', out.reason, reason.slice(0, 120))
    return out.ok ? out.memoryIds : []
  },

  pickRecoveryJudgeContext(ctx) {
    return recoveryJudgeContext(ctx.jobs, ctx.day)
  },
}

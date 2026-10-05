import { listDirectionStats, listIdeaOutcomes } from '@/lib/data/ideas'
import { listIdeaFocusDominions } from '@/lib/kairos/living/plan-ideas'
import {
  getLatestAether,
  listOpenObjectives,
  listOperatorReflections,
  listRecentBoardDays,
  listRecentConcepts,
  listTopHeldBeliefs,
} from '@/lib/data/idea-inputs'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { alreadyRanToday as aetherRanToday } from '@/lib/kairos/aether'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import {
  IDEA_GENERATE_MAX_OUTPUT_TOKENS,
  IDEA_GENERATE_SYSTEM_PROMPT,
  buildIdeaGeneratePrompt,
  digestAether,
  hasIdeaSignal,
  ideaInputIds,
  parseIdeaGenerateText,
  type GroundedGenerate,
  type IdeaGenerateInputs,
} from '@/lib/kairos/ideas/generate-prompt'
import { IDEA_GENERATE_KIND } from '@/lib/kairos/ideas/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, utcDay } from '../deadlines'
import { askPaidAndParse } from '../paid-fallback'
import { errorReason } from './_errors'
import {
  IDEA_TOURNAMENT_CRON,
  persistGenerate,
  readGenerateContext,
  type GenerateContext,
} from './idea-generate-apply'
import {
  jobContextOf,
  runAbandonGenerate,
  runAdjustGenerateInputs,
  runFallbackGenerate,
  runParseOptions,
  runPlanGenerate,
} from './idea-ext'

export {
  IDEA_CITED_IN_REVIEW,
  IDEA_RETRIEVED_PER_CANDIDATE,
  IDEA_TOURNAMENT_CRON,
  buildJudgeContext,
  candidateText,
  persistGenerate,
  repeatMeta,
} from './idea-generate-apply'

// Nightly idea tournament, stage 1 (docs/kairos/35). plan: once per UTC day,
// with ≥1 active Dominion, once today's Aether exists or from 03:30Z. apply:
// strict parse + citation grounding → embed each candidate → novelty gate
// against the idea archive / pending proposals / held beliefs → per-candidate
// evidence (cited + live retrieval) → plan the idea_judge job right away, so
// the routine's next claim (or the hourly sweep) picks it up. A night with no
// non-repeat candidate ends here: everything is archived, no judge.
// fallback: the hourly sweep's paid heavy-tier call (one repair round-trip).

// 55 min, not 60: the hourly sweep plans this at :50, so a 60-minute deadline
// would race the next sweep's own :50 expiry check and could slip an hour.
export const IDEA_GENERATE_DEADLINE_MINUTES = 55
export const IDEA_NOT_BEFORE_UTC = { hour: 3, minute: 30 }
export const IDEA_OUTCOME_DAYS = 30

export const ideaGenerateJobKey = (day: string) => `${IDEA_GENERATE_KIND}:${day}`

async function safe<T>(name: string, errors: string[], fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    errors.push(`${name}: ${errorReason(err)}`.slice(0, 200))
    return fallback
  }
}

// ── plan ──────────────────────────────────────────────────────────────────

export async function gatherIdeaInputs(userId: string, now: Date, dominions: IdeaGenerateInputs['dominions'], errors: string[]): Promise<IdeaGenerateInputs> {
  const [objectives, aether, board, beliefs, concepts, reflections, lessons, directionStats] = await Promise.all([
    safe('objectives', errors, [], () => listOpenObjectives(userId, dominions)),
    safe('aether', errors, null, () => getLatestAether(userId)),
    safe('board', errors, [], () => listRecentBoardDays(userId, now)),
    safe('beliefs', errors, [], () => listTopHeldBeliefs(userId)),
    safe('concepts', errors, [], () => listRecentConcepts(userId)),
    safe('reflections', errors, [], () => listOperatorReflections(userId, now)),
    safe('lessons', errors, [], () => listIdeaOutcomes(userId, IDEA_OUTCOME_DAYS)),
    safe('direction_stats', errors, [], () => listDirectionStats(userId, IDEA_OUTCOME_DAYS)),
  ])
  return {
    date: utcDay(now),
    dominions,
    objectives,
    aether: digestAether(aether),
    board,
    beliefs,
    concepts,
    reflections,
    lessons: lessons.map((l) => ({ title: l.title, direction: l.direction, claim: l.claim, outcome: l.outcome })),
    directionStats,
  }
}

export async function planIdeaGenerate(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const day = utcDay(now)
  const externalKey = ideaGenerateJobKey(day)
  if (await hasJobWithKeyLike(userId, IDEA_GENERATE_KIND, externalKey)) return []
  const afterCutoff = now.getTime() >= deadlineOn(now, IDEA_NOT_BEFORE_UTC).getTime()
  if (!afterCutoff && !(await aetherRanToday(userId))) return []
  const dominions = await listIdeaFocusDominions(userId)
  if (dominions.length === 0) return []

  const errors: string[] = []
  const planCtx = { userId, now, day, dominions, errors }
  const inputs = await runAdjustGenerateInputs(await gatherIdeaInputs(userId, now, dominions, errors), planCtx)
  if (!hasIdeaSignal(inputs)) return []
  const context: GenerateContext = { date: day, dominions, inputErrors: errors }
  const draft = await runPlanGenerate({
    system: IDEA_GENERATE_SYSTEM_PROMPT,
    prompt: buildIdeaGeneratePrompt(inputs),
    validMemoryIds: ideaInputIds(inputs),
    context,
  }, { ...planCtx, inputs })
  return [{
    kind: IDEA_GENERATE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: IDEA_GENERATE_DEADLINE_MINUTES,
    input: {
      system: draft.system,
      prompt: draft.prompt,
      validMemoryIds: draft.validMemoryIds,
      context: draft.context,
      maxOutputTokens: IDEA_GENERATE_MAX_OUTPUT_TOKENS,
    },
  }]
}

// ── apply ─────────────────────────────────────────────────────────────────

function parseFor(job: ThinkingJobRow) {
  const validIds = new Set(job.input.validMemoryIds ?? [])
  const opts = runParseOptions(jobContextOf(job))
  return (text: string) => parseIdeaGenerateText(text, validIds, opts)
}

export async function applyIdeaGenerate(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readGenerateContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid idea_generate context' }
  let grounded: GroundedGenerate
  try {
    grounded = parseFor(job)(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persistGenerate(job, ctx, grounded, answeredBy)
}

// Expected skips (no key) are not failures; anything else is traced.
export const BENIGN_DECLINES = new Set(['no BYOK credential', 'key undecryptable'])

export async function fallbackIdeaGenerate(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readGenerateContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid idea_generate context' }
  const settled = await runFallbackGenerate(job)
  if (settled) return settled
  try {
    const res = await askPaidAndParse(job, {
      parse: parseFor(job),
      label: 'idea-generate',
      maxTokens: job.input.maxOutputTokens ?? IDEA_GENERATE_MAX_OUTPUT_TOKENS,
      repairContext: [
        'Every candidate needs a "direction" equal to one of the directions\' "id" values, and ≥1 evidence id from this list, verbatim:',
        ...(job.input.validMemoryIds ?? []).map((id) => `- ${id}`),
      ].join('\n'),
      reasonPrefix: 'parse_failed: ',
    })
    if (!res.ok) {
      if (!BENIGN_DECLINES.has(res.reason)) {
        await writeCronFailureTrace(job.userId, { cronName: IDEA_TOURNAMENT_CRON, reason: 'generate_failed', rawExcerpt: res.reason })
      }
      return res
    }
    return await persistGenerate(job, ctx, res.value, 'api')
  } catch (err) {
    // Provider outage / DB error: trace it so an unarmed health stage still
    // sees the failed night, then let the sweep record the fallback error.
    try {
      await writeCronFailureTrace(job.userId, {
        cronName: IDEA_TOURNAMENT_CRON,
        reason: 'generate_failed',
        rawExcerpt: err instanceof Error ? err.message : String(err),
      })
    } catch { /* tracing is best-effort */ }
    throw err
  }
}

// The sweep gave up on a generate job: only a lane-owned job (e.g. a
// resample) has anything to settle; the base night needs nothing.
export async function abandonIdeaGenerate(job: ThinkingJobRow, reason: string): Promise<string[]> {
  return (await runAbandonGenerate(job, reason)) ?? []
}

export const ideaGenerateHandler: ThinkingJobHandler = {
  kind: IDEA_GENERATE_KIND,
  plan: planIdeaGenerate,
  apply: applyIdeaGenerate,
  fallback: fallbackIdeaGenerate,
  abandon: abandonIdeaGenerate,
}

import { z } from 'zod'
import { findNearestIdeaNeighbours, listDirectionStats, listIdeaOutcomes, writeTournament } from '@/lib/data/ideas'
import {
  getLatestAether,
  listActiveDominions,
  listEvidenceSnippets,
  listOpenObjectives,
  listOperatorReflections,
  listRecentBoardDays,
  listRecentConcepts,
  listTopHeldBeliefs,
  type IdeaEvidenceSnippet,
} from '@/lib/data/idea-inputs'
import { hasJobWithKeyLike, upsertJob } from '@/lib/data/thinking-jobs'
import { alreadyRanToday as aetherRanToday } from '@/lib/kairos/aether'
import { packVector, unpackVector } from '@/lib/kairos/constitution/drift'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { renderIdeaBody } from '@/lib/kairos/ideas/compose'
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
import { buildJudgeSpec, type IdeaJudgeContext, type StoredCandidate } from '@/lib/kairos/ideas/judge-context'
import { classifyNovelty } from '@/lib/kairos/ideas/novelty'
import { scheduleMatches } from '@/lib/kairos/ideas/pairing'
import { IDEA_CANDIDATE_TYPE, IDEA_GENERATE_KIND, type IdeaMeta } from '@/lib/kairos/ideas/types'
import { searchSubstrateForChat } from '@/lib/kairos/retrieve'
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
export const IDEA_TOURNAMENT_CRON = 'idea-tournament'
export const IDEA_OUTCOME_DAYS = 30
// Live memories retrieved per candidate on top of its citations; cited ids
// shown to the judge are capped so the review prompt stays bounded.
export const IDEA_RETRIEVED_PER_CANDIDATE = 5
export const IDEA_CITED_IN_REVIEW = 4
const NEIGHBOUR_LIMIT = 5
const CONCURRENCY = 4

export const ideaGenerateJobKey = (day: string) => `${IDEA_GENERATE_KIND}:${day}`

const contextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dominions: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  inputErrors: z.array(z.string()).default([]),
})
type GenerateContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): GenerateContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function safe<T>(name: string, errors: string[], fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    errors.push(`${name}: ${errorReason(err)}`.slice(0, 200))
    return fallback
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
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
  const dominions = await listActiveDominions(userId)
  if (dominions.length === 0) return []

  const errors: string[] = []
  const inputs = await gatherIdeaInputs(userId, now, dominions, errors)
  if (!hasIdeaSignal(inputs)) return []
  const context: GenerateContext = { date: day, dominions, inputErrors: errors }
  return [{
    kind: IDEA_GENERATE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: IDEA_GENERATE_DEADLINE_MINUTES,
    input: {
      system: IDEA_GENERATE_SYSTEM_PROMPT,
      prompt: buildIdeaGeneratePrompt(inputs),
      validMemoryIds: ideaInputIds(inputs),
      context,
      maxOutputTokens: IDEA_GENERATE_MAX_OUTPUT_TOKENS,
    },
  }]
}

// ── apply ─────────────────────────────────────────────────────────────────

// Prior Kairos ideas never count as evidence for a new one.
function isEvidence(s: IdeaEvidenceSnippet): boolean {
  return s.kind !== 'idea' && s.type !== IDEA_CANDIDATE_TYPE
}

async function embedCandidate(text: string): Promise<number[] | null> {
  try {
    return await embedOne(text, 'document')
  } catch (err) {
    console.warn('[kairos:idea-generate] embed failed:', errorReason(err))
    return null
  }
}

async function retrieveFor(userId: string, query: string): Promise<string[]> {
  try {
    return (await searchSubstrateForChat(userId, query, IDEA_RETRIEVED_PER_CANDIDATE + 2)).map((m) => m.id)
  } catch (err) {
    console.warn('[kairos:idea-generate] retrieval failed:', errorReason(err))
    return []
  }
}

export const candidateText = (c: { title: string; claim: string }) => `${c.title}\n${c.claim}`

export async function buildJudgeContext(
  job: ThinkingJobRow,
  ctx: GenerateContext,
  grounded: GroundedGenerate,
): Promise<{ judge: IdeaJudgeContext; embedFailures: number }> {
  const userId = job.userId
  let embedFailures = 0
  const scored = await mapLimit(grounded.candidates, CONCURRENCY, async (c) => {
    const vector = await embedCandidate(candidateText(c))
    if (!vector) embedFailures++
    const neighbours = vector ? await findNearestIdeaNeighbours(userId, vector, NEIGHBOUR_LIMIT) : []
    const novelty = classifyNovelty(neighbours)
    const retrieved = novelty.class === 'repeat' ? [] : await retrieveFor(userId, `${c.title}. ${c.claim}`)
    return { c, vector, novelty, retrieved }
  })

  const evidenceIds = scored.flatMap((s) => [...s.c.citedIds, ...s.retrieved])
  const nearestIds = scored.map((s) => s.novelty.nearestId).filter((id): id is string => Boolean(id))
  const [evidenceRows, nearestRows] = await Promise.all([
    listEvidenceSnippets(userId, evidenceIds),
    listEvidenceSnippets(userId, nearestIds, { liveOnly: false }),
  ])
  const evidenceById = new Map(evidenceRows.filter(isEvidence).map((s) => [s.id, s]))
  const nearestById = new Map(nearestRows.map((s) => [s.id, s]))

  const candidates: StoredCandidate[] = scored.map(({ c, vector, novelty, retrieved }) => {
    const cited = c.citedIds.filter((id) => evidenceById.has(id)).slice(0, IDEA_CITED_IN_REVIEW)
    const extra = retrieved.filter((id) => evidenceById.has(id) && !cited.includes(id)).slice(0, IDEA_RETRIEVED_PER_CANDIDATE)
    return { ...c, novelty, evidenceIds: [...cited, ...extra], vector: vector ? packVector(vector) : null }
  })

  const shownIds = new Set(candidates.filter((c) => c.novelty.class !== 'repeat').flatMap((c) => c.evidenceIds))
  const evidence: IdeaJudgeContext['evidence'] = {}
  for (const id of shownIds) {
    const s = evidenceById.get(id)
    if (s) evidence[id] = { id, title: s.title, text: s.text, origin: s.origin, dominionId: s.dominionId }
  }
  const nearest: IdeaJudgeContext['nearest'] = {}
  for (const c of candidates) {
    const n = c.novelty
    if (n.class !== 'borderline' || !n.nearestId || !n.nearestKind) continue
    const s = nearestById.get(n.nearestId)
    if (s) nearest[n.nearestId] = { id: s.id, kind: n.nearestKind, title: s.title, text: s.text }
  }

  const schedule = scheduleMatches(candidates.filter((c) => c.novelty.class !== 'repeat').map((c) => c.key))
  return {
    judge: { date: ctx.date, generateJobId: job.id, candidates, evidence, nearest, pairs: schedule.pairs, matches: schedule.matches },
    embedFailures,
  }
}

// Archive row for a candidate that never reached the judge (all repeats).
export function repeatMeta(c: StoredCandidate, tournamentDate: string, generateJobId: string): IdeaMeta {
  return {
    v: 1,
    tournamentDate,
    generateJobId,
    judgeJobId: null,
    key: c.key,
    direction: c.direction,
    claim: c.claim,
    why: c.why,
    nextStep: c.nextStep,
    status: 'repeat',
    eliminatedReason: 'repeat',
    elo: null,
    rank: null,
    novelty: c.novelty,
    critique: null,
    refined: false,
    survivedBecause: null,
    outcome: null,
    outcomeAt: null,
  }
}

async function endNightEarly(job: ThinkingJobRow, judge: IdeaJudgeContext, reason: string): Promise<string[]> {
  const evidence = new Map(Object.values(judge.evidence).map((e) => [e.id, e]))
  const res = await writeTournament(job.userId, {
    tournamentDate: judge.date,
    generateJobId: job.id,
    // No judge ran tonight.
    judgeJobId: null,
    survivors: [],
    others: judge.candidates.map((c) => ({
      title: c.title,
      bodyMd: renderIdeaBody({ ...c, survivedBecause: null }, evidence),
      embedding: c.vector ? unpackVector(c.vector) : null,
      dominionId: null,
      meta: repeatMeta(c, judge.date, job.id),
    })),
  })
  await writeCronSuccessTrace(job.userId, {
    cronName: IDEA_TOURNAMENT_CRON,
    outcome: 'skipped',
    skipReason: reason,
    details: { candidates: judge.candidates.length, survivors: 0 },
  })
  return [...res.survivorIds, ...res.archivedIds]
}

export async function persistGenerate(
  job: ThinkingJobRow,
  ctx: GenerateContext,
  grounded: GroundedGenerate,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const { judge, embedFailures } = await buildJudgeContext(job, ctx, grounded)
  const contenders = judge.candidates.filter((c) => c.novelty.class !== 'repeat').length
  const summary = {
    tournamentDate: ctx.date,
    answeredBy,
    directions: grounded.directions,
    candidates: judge.candidates.map((c) => ({ key: c.key, direction: c.direction, title: c.title, novelty: c.novelty.class })),
    dropped: grounded.dropped,
    contenders,
    embedFailures,
  }

  if (contenders === 0) {
    const reason = 'no_novel_candidates'
    const memoryIds = await endNightEarly(job, judge, reason)
    return { ok: true, memoryIds, output: { ...summary, ended: reason, judgeJobId: null } }
  }

  const row = await upsertJob(job.userId, buildJudgeSpec(judge))
  return { ok: true, memoryIds: [], output: { ...summary, judgeContext: judge, judgeJobId: row?.id ?? null } }
}

function parseFor(job: ThinkingJobRow) {
  const validIds = new Set(job.input.validMemoryIds ?? [])
  return (text: string) => parseIdeaGenerateText(text, validIds)
}

export async function applyIdeaGenerate(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
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
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid idea_generate context' }
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

export const ideaGenerateHandler: ThinkingJobHandler = {
  kind: IDEA_GENERATE_KIND,
  plan: planIdeaGenerate,
  apply: applyIdeaGenerate,
  fallback: fallbackIdeaGenerate,
}

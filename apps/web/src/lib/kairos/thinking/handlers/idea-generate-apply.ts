import { z } from 'zod'
import { findNearestIdeaNeighbours, writeTournament } from '@/lib/data/ideas'
import { listEvidenceSnippets, type IdeaEvidenceSnippet } from '@/lib/data/idea-inputs'
import { upsertJob } from '@/lib/data/thinking-jobs'
import { packVector, unpackVector } from '@/lib/kairos/constitution/drift'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { renderIdeaBody } from '@/lib/kairos/ideas/compose'
import type { GroundedGenerate } from '@/lib/kairos/ideas/generate-prompt'
import { buildJudgeSpec, type IdeaJudgeContext, type StoredCandidate } from '@/lib/kairos/ideas/judge-context'
import { classifyNovelty } from '@/lib/kairos/ideas/novelty'
import { scheduleMatches } from '@/lib/kairos/ideas/pairing'
import { IDEA_CANDIDATE_TYPE, type IdeaMeta } from '@/lib/kairos/ideas/types'
import { searchSubstrateForChat } from '@/lib/kairos/retrieve'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobRow } from '@/lib/kairos/engine/types'
import { errorReason } from './_errors'
import {
  jobContextOf,
  runAfterParse,
  runBeforePlanJudge,
  runBuildJudgeContextExtras,
  runEnrichStoredCandidate,
  runSummarizeGenerate,
  type GenerateApplyScope,
} from './idea-ext'

// idea_generate apply side (docs/kairos/35): embed each grounded candidate,
// novelty gate, per-candidate evidence, then plan the idea_judge job (or end
// the night early when nothing novel is left). Wave 3 lane hooks run through
// ./idea-ext and are no-ops when their flags are off.

export const IDEA_TOURNAMENT_CRON = 'idea-tournament'
// Live memories retrieved per candidate on top of its citations; cited ids
// shown to the judge are capped so the review prompt stays bounded.
export const IDEA_RETRIEVED_PER_CANDIDATE = 5
export const IDEA_CITED_IN_REVIEW = 4
const NEIGHBOUR_LIMIT = 5
const CONCURRENCY = 4

// Loose: lane extensions add their own top-level keys at plan time.
export const generateContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dominions: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  inputErrors: z.array(z.string()).default([]),
}).passthrough()
export type GenerateContext = z.infer<typeof generateContextSchema>

export function readGenerateContext(job: ThinkingJobRow): GenerateContext | null {
  const parsed = generateContextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
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

// scope: lane hooks run only when given (persistGenerate always passes one).
export async function buildJudgeContext(
  job: ThinkingJobRow,
  ctx: GenerateContext,
  grounded: GroundedGenerate,
  scope?: GenerateApplyScope,
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

  const enrich = scope ? { ...scope, grounded, evidence: evidenceById } : null
  const candidates: StoredCandidate[] = scored.map(({ c, vector, novelty, retrieved }) => {
    const cited = c.citedIds.filter((id) => evidenceById.has(id)).slice(0, IDEA_CITED_IN_REVIEW)
    const extra = retrieved.filter((id) => evidenceById.has(id) && !cited.includes(id)).slice(0, IDEA_RETRIEVED_PER_CANDIDATE)
    const stored: StoredCandidate = { ...c, novelty, evidenceIds: [...cited, ...extra], vector: vector ? packVector(vector) : null }
    return enrich ? runEnrichStoredCandidate(stored, c, enrich) : stored
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
  const judge: IdeaJudgeContext = { date: ctx.date, generateJobId: job.id, candidates, evidence, nearest, pairs: schedule.pairs, matches: schedule.matches }
  return {
    judge: scope ? await runBuildJudgeContextExtras(judge, { ...scope, grounded }) : judge,
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
  parsed: GroundedGenerate,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const scope: GenerateApplyScope = { job, jobContext: jobContextOf(job), answeredBy, scratch: {} }
  const grounded = await runAfterParse(parsed, scope)
  const { judge, embedFailures } = await buildJudgeContext(job, ctx, grounded, scope)
  const hookCtx = { ...scope, grounded }
  const deferral = await runBeforePlanJudge(judge, hookCtx)
  const contenders = judge.candidates.filter((c) => c.novelty.class !== 'repeat').length
  const summary = {
    tournamentDate: ctx.date,
    answeredBy,
    directions: grounded.directions,
    candidates: judge.candidates.map((c) => ({ key: c.key, direction: c.direction, title: c.title, novelty: c.novelty.class })),
    dropped: grounded.dropped,
    contenders,
    embedFailures,
    ...runSummarizeGenerate(judge, hookCtx),
  }

  if (deferral) return { ok: true, memoryIds: [], output: { ...summary, ...deferral.output } }

  if (contenders === 0) {
    const reason = 'no_novel_candidates'
    const memoryIds = await endNightEarly(job, judge, reason)
    return { ok: true, memoryIds, output: { ...summary, ended: reason, judgeJobId: null } }
  }

  const row = await upsertJob(job.userId, buildJudgeSpec(judge))
  return { ok: true, memoryIds: [], output: { ...summary, judgeContext: judge, judgeJobId: row?.id ?? null } }
}

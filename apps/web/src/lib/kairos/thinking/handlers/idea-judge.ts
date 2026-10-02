import { IDEA_JUDGE_FAILED_REASON, writeTournament } from '@/lib/data/ideas'
import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { unpackVector } from '@/lib/kairos/constitution/drift'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { majorityDominion, renderIdeaBody, survivedBecause, type EvidenceRef } from '@/lib/kairos/ideas/compose'
import { computeElo, type EloRecord } from '@/lib/kairos/ideas/elo'
import {
  IDEA_JUDGE_MAX_OUTPUT_TOKENS,
  parseIdeaJudgeText,
  type GroundedJudge,
} from '@/lib/kairos/ideas/judge-prompt'
import {
  buildJudgeSpec,
  contenders,
  ideaJudgeJobKey,
  readJudgeContext,
  type IdeaJudgeContext,
  type StoredCandidate,
} from '@/lib/kairos/ideas/judge-context'
import { selectSurvivors, type SelectionResult } from '@/lib/kairos/ideas/select'
import { IDEA_GENERATE_KIND, IDEA_JUDGE_KIND, type IdeaMeta } from '@/lib/kairos/ideas/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { utcDay } from '../deadlines'
import { askPaidAndParse } from '../paid-fallback'
import { errorReason } from './_errors'
import { BENIGN_DECLINES, IDEA_TOURNAMENT_CRON, candidateText, ideaGenerateJobKey, repeatMeta } from './idea-generate'
import { PAID_BACKUP_OFF_NOTE } from '@/lib/ai/paid-backup-off'

// Nightly idea tournament, stage 2 (docs/kairos/35). Normally planned by the
// idea_generate apply; plan() here is recovery only (today's generate job is
// done, no judge job exists → rebuild the spec from the generate output).
// apply: strict parse + grounding (supports/contradicts within each
// candidate's own evidence) → Elo over the double-legged matches → selection
// → the judge's refinements applied to survivors → one writeTournament
// (survivors to the inbox, everything else archived) → cron trace.
// fallback: the hourly sweep's paid heavy-tier call (one repair round-trip).

const DONE_STATUSES = new Set(['done', 'fallback'])

export async function planIdeaJudge(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const day = utcDay(now)
  if (await hasJobWithKeyLike(userId, IDEA_JUDGE_KIND, ideaJudgeJobKey(day))) return []
  const generateKey = ideaGenerateJobKey(day)
  const jobs = await listJobs(userId, { kind: IDEA_GENERATE_KIND, limit: 5 })
  const generate = jobs.find((j) => j.externalKey === generateKey && DONE_STATUSES.has(j.status))
  if (!generate) return []
  const ctx = readJudgeContext(generate.output?.judgeContext)
  if (!ctx || contenders(ctx).length === 0) return []
  return [buildJudgeSpec(ctx)]
}

function readContext(job: ThinkingJobRow): IdeaJudgeContext | null {
  return readJudgeContext(job.input?.context)
}

function parseFor(ctx: IdeaJudgeContext) {
  const parseCtx = { candidates: contenders(ctx), matches: ctx.matches }
  return (text: string) => parseIdeaJudgeText(text, parseCtx)
}

const round1 = (n: number) => Math.round(n * 10) / 10

async function survivorEmbedding(c: StoredCandidate, refinedClaim: string | null): Promise<number[] | null> {
  const original = c.vector ? unpackVector(c.vector) : null
  if (!refinedClaim) return original
  try {
    return (await embedOne(candidateText({ title: c.title, claim: refinedClaim }), 'document')) ?? original
  } catch (err) {
    console.warn('[kairos:idea-judge] re-embed of refined survivor failed:', errorReason(err))
    return original
  }
}

export interface TournamentRow {
  title: string
  bodyMd: string
  embedding: number[] | null
  dominionId: string | null
  meta: IdeaMeta
}

export interface TournamentRows {
  survivors: Array<TournamentRow & { citedIds: string[] }>
  others: TournamentRow[]
  selection: SelectionResult[]
}

// Pure assembly of tonight's rows (embeddings resolved by the caller).
export function assembleTournament(
  ctx: IdeaJudgeContext,
  judgeJobId: string,
  judged: GroundedJudge,
  elo: ReadonlyMap<string, EloRecord>,
  embeddings: ReadonlyMap<string, number[] | null>,
): TournamentRows {
  const selection = selectSurvivors(ctx.candidates.map((c) => ({
    key: c.key,
    novelty: c.novelty,
    critique: judged.critiques.get(c.key) ?? null,
    record: elo.get(c.key) ?? null,
  })))
  const evidence = new Map<string, EvidenceRef>(Object.values(ctx.evidence).map((e) => [e.id, e]))
  const survivors: TournamentRows['survivors'] = []
  const others: TournamentRows['others'] = []
  const ordered = ctx.candidates
    .map((c, i) => ({ c, s: selection[i] }))
    .sort((x, y) => (x.s.rank ?? Infinity) - (y.s.rank ?? Infinity))

  for (const { c, s } of ordered) {
    const critique = judged.critiques.get(c.key) ?? null
    const record = elo.get(c.key) ?? null
    const isSurvivor = s.status === 'survivor'
    const refinement = isSurvivor ? judged.refinements.get(c.key) ?? null : null
    const wording = refinement ?? { claim: c.claim, why: c.why, nextStep: c.nextStep }
    const because = isSurvivor && critique ? survivedBecause(critique, record, evidence) : null
    const meta: IdeaMeta = {
      v: 1,
      tournamentDate: ctx.date,
      generateJobId: ctx.generateJobId,
      judgeJobId,
      key: c.key,
      direction: c.direction,
      ...wording,
      status: s.status,
      eliminatedReason: s.eliminatedReason,
      elo: c.novelty.class === 'repeat' || !record ? null : round1(record.elo),
      rank: s.rank,
      novelty: c.novelty,
      critique,
      refined: refinement !== null,
      survivedBecause: because,
      outcome: null,
      outcomeAt: null,
    }
    const bodyMd = renderIdeaBody({ direction: c.direction, ...wording, evidenceIds: c.evidenceIds, survivedBecause: because }, evidence)
    const dominionId = majorityDominion(c.evidenceIds, evidence)
    const embedding = embeddings.get(c.key) ?? null
    if (isSurvivor) {
      const citedIds = [...new Set([...c.citedIds, ...(critique?.supports ?? [])])]
      survivors.push({ title: c.title, bodyMd, embedding, citedIds, dominionId, meta })
    } else {
      others.push({ title: c.title, bodyMd, embedding, dominionId, meta })
    }
  }
  return { survivors, others, selection }
}

export async function persistJudge(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  judged: GroundedJudge,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const keys = contenders(ctx).map((c) => c.key)
  const elo = computeElo(keys, ctx.pairs, judged.votes)
  // Pre-select to know which survivors need a re-embed after refinement.
  const draft = assembleTournament(ctx, job.id, judged, elo, new Map())
  const survivorKeys = new Set(draft.selection.filter((s) => s.status === 'survivor').map((s) => s.key))
  const embeddings = new Map<string, number[] | null>()
  for (const c of ctx.candidates) {
    const refined = survivorKeys.has(c.key) ? judged.refinements.get(c.key)?.claim ?? null : null
    embeddings.set(c.key, await survivorEmbedding(c, refined))
  }
  const rows = assembleTournament(ctx, job.id, judged, elo, embeddings)

  const res = await writeTournament(job.userId, {
    tournamentDate: ctx.date,
    generateJobId: ctx.generateJobId,
    judgeJobId: job.id,
    survivors: rows.survivors,
    others: rows.others,
  })

  const eliminated: Record<string, number> = {}
  for (const s of rows.selection) if (s.eliminatedReason) eliminated[s.eliminatedReason] = (eliminated[s.eliminatedReason] ?? 0) + 1
  const summary = {
    tournamentDate: ctx.date,
    answeredBy,
    written: res.written,
    candidates: ctx.candidates.length,
    contenders: keys.length,
    matches: ctx.matches.length,
    votes: judged.votes.size,
    survivors: rows.survivors.map((s) => ({ key: s.meta.key, title: s.title, elo: s.meta.elo, refined: s.meta.refined })),
    eliminated,
  }
  await writeCronSuccessTrace(job.userId, {
    cronName: IDEA_TOURNAMENT_CRON,
    outcome: rows.survivors.length > 0 ? 'ok' : 'skipped',
    ...(rows.survivors.length > 0 ? {} : { skipReason: 'no_survivors' }),
    details: { candidates: summary.candidates, contenders: summary.contenders, survivors: rows.survivors.length, eliminated },
  })
  return { ok: true, memoryIds: [...res.survivorIds, ...res.archivedIds], output: { tournament: summary } }
}

export async function applyIdeaJudge(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid idea_judge context' }
  let judged: GroundedJudge
  try {
    judged = parseFor(ctx)(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persistJudge(job, ctx, judged, answeredBy)
}

export async function fallbackIdeaJudge(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid idea_judge context' }
  try {
    const res = await askPaidAndParse(job, {
      parse: parseFor(ctx),
      label: 'idea-judge',
      maxTokens: job.input.maxOutputTokens ?? IDEA_JUDGE_MAX_OUTPUT_TOKENS,
      repairContext: [
        'Critique EVERY candidate key once; supports/contradicts only from that candidate\'s evidence ids:',
        ...contenders(ctx).map((c) => `- ${c.key}: ${c.evidenceIds.join(', ') || '(no evidence)'}`),
        'Matches (winner must be A or B of that match, given as its key):',
        ...ctx.matches.map((m) => `- ${m.id}: A = ${m.first}, B = ${m.second}`),
      ].join('\n'),
      reasonPrefix: 'parse_failed: ',
    })
    if (!res.ok) {
      if (!BENIGN_DECLINES.has(res.reason)) {
        await writeCronFailureTrace(job.userId, { cronName: IDEA_TOURNAMENT_CRON, reason: 'judge_failed', rawExcerpt: res.reason })
      }
      return res
    }
    return await persistJudge(job, ctx, res.value, 'api')
  } catch (err) {
    try {
      await writeCronFailureTrace(job.userId, {
        cronName: IDEA_TOURNAMENT_CRON,
        reason: 'judge_failed',
        rawExcerpt: err instanceof Error ? err.message : String(err),
      })
    } catch { /* tracing is best-effort */ }
    throw err
  }
}

export const ideaJudgeHandler: ThinkingJobHandler = {
  kind: IDEA_JUDGE_KIND,
  plan: planIdeaJudge,
  apply: applyIdeaJudge,
  fallback: fallbackIdeaJudge,
  abandon: abandonIdeaJudge,
}

// Archive row for a candidate no judge ever ruled on (routine and fallback
// both failed); a repeat stays a repeat.
export function unjudgedMeta(c: StoredCandidate, ctx: IdeaJudgeContext, judgeJobId: string): IdeaMeta {
  const meta = { ...repeatMeta(c, ctx.date, ctx.generateJobId), judgeJobId }
  if (c.novelty.class === 'repeat') return meta
  return { ...meta, status: 'eliminated', eliminatedReason: IDEA_JUDGE_FAILED_REASON }
}

// The sweep gave up on tonight's judge: archive every candidate (no
// survivors) so the night is on record. writeTournament is idempotent per
// date, so a late successful write can't duplicate rows. With Paid backup off
// no fallback ran, so nothing traced the failure yet — trace it here.
export async function abandonIdeaJudge(job: ThinkingJobRow, reason: string): Promise<string[]> {
  const ctx = readContext(job)
  if (!ctx) return []
  const evidence = new Map(Object.values(ctx.evidence).map((e) => [e.id, e]))
  const res = await writeTournament(job.userId, {
    tournamentDate: ctx.date,
    generateJobId: ctx.generateJobId,
    judgeJobId: job.id,
    survivors: [],
    others: ctx.candidates.map((c) => ({
      title: c.title,
      bodyMd: renderIdeaBody({ ...c, survivedBecause: null }, evidence),
      embedding: c.vector ? unpackVector(c.vector) : null,
      dominionId: null,
      meta: unjudgedMeta(c, ctx, job.id),
    })),
  })
  if (res.written && reason === PAID_BACKUP_OFF_NOTE) {
    await writeCronFailureTrace(job.userId, { cronName: IDEA_TOURNAMENT_CRON, reason: 'judge_unanswered', rawExcerpt: reason })
  }
  return [...res.survivorIds, ...res.archivedIds]
}

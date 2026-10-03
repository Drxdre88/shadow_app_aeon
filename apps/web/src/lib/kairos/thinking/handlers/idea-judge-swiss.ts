import { upsertJob } from '@/lib/data/thinking-jobs'
import type { GroundedJudge } from '@/lib/kairos/ideas/judge-prompt'
import { contenders, ideaJudgeRoundJobKey, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { eliminationReason } from '@/lib/kairos/ideas/select'
import { maxIdNumber, readAtlasJudge } from '@/lib/kairos/ideas/atlas/judge'
import { pairKey, pairSwissRound, swissStandings, toRoundSchedule } from '@/lib/kairos/ideas/swiss/pairing'
import {
  SWISS_ROUND_MAX_OUTPUT_TOKENS,
  SWISS_ROUND_SYSTEM_PROMPT,
  buildSwissRoundPrompt,
  parseSwissRoundText,
} from '@/lib/kairos/ideas/swiss/round-prompt'
import {
  critiquesFrom,
  critiquesToRecord,
  readSwissState,
  refinementsFrom,
  refinementsToRecord,
  votesFrom,
  type SwissState,
} from '@/lib/kairos/ideas/swiss/state'
import { IDEA_JUDGE_KIND } from '@/lib/kairos/ideas/types'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { deadlineOn, minutesUntil } from '../deadlines'
import { errorReason } from './_errors'

// Swiss multi-round idea judge (lane A, KAIROS_IDEA_SWISS). Round 1 is the
// normal full judge (critiques, refinements, votes) over folded pairs. When
// the routine answered it and ≥2 candidates are viable, the next round is a
// follow-on idea_judge job (idea_judge:<day>:r<k>, votes only) planned in the
// same apply, so the routine's next claim picks it up. The last round runs
// persistJudge ONCE with every Swiss pair in round order. A round that fails,
// expires or is abandoned finishes the night with the votes collected so far
// — no paid call is ever made for rounds ≥ 2.

export type PersistJudgeFn = (
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  judged: GroundedJudge,
  answeredBy: ThinkingAnsweredBy,
) => Promise<ApplyOutcome>

// Mirrors daily-message NIGHT_SETTLED_UTC: past this the 06:00 message plans
// regardless, so a round planned before it must close by then.
export const SWISS_SETTLE_UTC = { hour: 4, minute: 35 }
export const SWISS_ROUND_DEADLINE_MINUTES = 45
export const SWISS_ROUND_MIN_MINUTES = 5

export const readSwiss = (ctx: IdeaJudgeContext): SwissState | null => readSwissState(ctx.swiss)

// null → no time left for another round before the night settles.
export function swissRoundDeadlineMinutes(now: Date): number | null {
  const settle = deadlineOn(now, SWISS_SETTLE_UTC)
  if (now.getTime() >= settle.getTime()) return SWISS_ROUND_DEADLINE_MINUTES
  const left = minutesUntil(now, settle)
  if (left < SWISS_ROUND_MIN_MINUTES) return null
  return Math.min(SWISS_ROUND_DEADLINE_MINUTES, left)
}

export function viableKeys(ctx: IdeaJudgeContext, critiques: GroundedJudge['critiques']): string[] {
  return contenders(ctx)
    .filter((c) => eliminationReason({
      key: c.key,
      novelty: c.novelty,
      critique: critiques.get(c.key) ?? null,
      record: null,
      ...(c.bridge ? { bridged: true } : {}),
    }) === null)
    .map((c) => c.key)
}

const roundMatches = (ctx: IdeaJudgeContext, s: SwissState) => {
  const ids = new Set(s.roundPairIds)
  return ctx.matches.filter((m) => ids.has(m.pairId))
}

// The next round's job spec, or null when no rematch-free pairing is left.
export function planSwissRound(ctx: IdeaJudgeContext, s: SwissState, deadlineMinutes: number): ThinkingJobSpec | null {
  const votes = votesFrom(s)
  const standings = swissStandings(contenders(ctx).map((c) => c.key), ctx.pairs, votes, s.byes)
  const played = new Set(ctx.pairs.map((p) => pairKey(p.a, p.b)))
  const pairing = pairSwissRound(s.viable, standings, played, new Set(s.byes))
  if (!pairing || pairing.pairs.length === 0) return null
  const challengeIds = readAtlasJudge(ctx.atlas)?.challenges.map((c) => c.id) ?? []
  const sched = toRoundSchedule(pairing.pairs, {
    pair: maxIdNumber([...ctx.pairs.map((p) => p.id), ...challengeIds]),
    match: maxIdNumber(ctx.matches.map((m) => m.id)),
  })
  const round = s.round + 1
  const next: SwissState = {
    ...s,
    round,
    roundPairIds: sched.pairs.map((p) => p.id),
    byes: pairing.bye ? [...s.byes, pairing.bye] : s.byes,
  }
  const context: IdeaJudgeContext = { ...ctx, pairs: [...ctx.pairs, ...sched.pairs], matches: [...ctx.matches, ...sched.matches], swiss: next }
  return {
    kind: IDEA_JUDGE_KIND,
    dominionId: null,
    externalKey: ideaJudgeRoundJobKey(ctx.date, round),
    deadlineMinutes,
    input: {
      system: SWISS_ROUND_SYSTEM_PROMPT,
      prompt: buildSwissRoundPrompt({ date: ctx.date, round, rounds: s.rounds, candidates: contenders(ctx), matches: sched.matches }),
      validMemoryIds: [],
      context,
      maxOutputTokens: SWISS_ROUND_MAX_OUTPUT_TOKENS,
    },
  }
}

function swissSummary(ctx: IdeaJudgeContext, s: SwissState, extra: Record<string, unknown> = {}) {
  return { rounds: s.round, planned: s.rounds, pairs: ctx.pairs.length, byes: s.byes.length, viable: s.viable.length, ...extra }
}

// Persist the whole night once with every vote collected so far.
export async function finishSwiss(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  s: SwissState,
  answeredBy: ThinkingAnsweredBy,
  persist: PersistJudgeFn,
  extra: Record<string, unknown> = {},
): Promise<ApplyOutcome> {
  const judged: GroundedJudge = { critiques: critiquesFrom(s), votes: votesFrom(s), refinements: refinementsFrom(s) }
  const out = await persist(job, ctx, judged, answeredBy)
  if (!out.ok) return out
  const tournament = (out.output?.tournament ?? {}) as Record<string, unknown>
  return { ...out, output: { ...out.output, tournament: { ...tournament, swiss: swissSummary(ctx, s, extra) } } }
}

async function continueOrFinish(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  s: SwissState,
  answeredBy: ThinkingAnsweredBy,
  persist: PersistJudgeFn,
  now: Date,
): Promise<ApplyOutcome> {
  const lastRound = Math.min(s.rounds, s.viable.length - 1)
  const deadline = swissRoundDeadlineMinutes(now)
  if (answeredBy === 'routine' && s.round < lastRound && deadline !== null) {
    const spec = planSwissRound(ctx, s, deadline)
    if (spec) {
      const row = await upsertJob(job.userId, spec, now)
      return { ok: true, memoryIds: [], output: { swiss: { round: s.round, nextRound: s.round + 1, nextJobId: row?.id ?? null, votes: Object.keys(s.votes).length } } }
    }
  }
  return finishSwiss(job, ctx, s, answeredBy, persist)
}

// Round 1 answered (full judge): keep critiques/refinements/viable, then chain.
export async function continueSwissRound1(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  s: SwissState,
  judged: GroundedJudge,
  answeredBy: ThinkingAnsweredBy,
  persist: PersistJudgeFn,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  const next: SwissState = {
    ...s,
    votes: { ...s.votes, ...Object.fromEntries(judged.votes) },
    critiques: critiquesToRecord(judged.critiques),
    refinements: refinementsToRecord(judged.refinements),
    viable: viableKeys(ctx, judged.critiques),
  }
  return continueOrFinish(job, { ...ctx, swiss: next }, next, answeredBy, persist, now)
}

// Round ≥ 2 answered: merge its votes and chain; a bad answer finishes the
// night on the votes already collected.
export async function applySwissRound(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  s: SwissState,
  text: string,
  answeredBy: ThinkingAnsweredBy,
  persist: PersistJudgeFn,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  let votes: Map<string, string>
  try {
    votes = parseSwissRoundText(text, roundMatches(ctx, s))
  } catch (err) {
    return finishSwiss(job, ctx, s, answeredBy, persist, { stopped: `parse_failed: ${errorReason(err)}`.slice(0, 200) })
  }
  const next: SwissState = { ...s, votes: { ...s.votes, ...Object.fromEntries(votes) } }
  return continueOrFinish(job, { ...ctx, swiss: next }, next, answeredBy, persist, now)
}

// Sweep fallback / abandon for rounds ≥ 2: finish with what was collected.
export async function finishUnansweredRound(
  job: ThinkingJobRow,
  ctx: IdeaJudgeContext,
  s: SwissState,
  reason: string,
  persist: PersistJudgeFn,
): Promise<ApplyOutcome> {
  return finishSwiss(job, ctx, s, 'deterministic', persist, { stopped: reason.slice(0, 200) })
}

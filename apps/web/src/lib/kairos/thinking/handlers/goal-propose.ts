import { z } from 'zod'
import { countOpenGoals, listFailedGoals, listGoalSimilarities, listOpenGoals } from '@/lib/data/goals'
import { listIdeaOutcomes } from '@/lib/data/ideas'
import { listActiveDominions, listOpenObjectives } from '@/lib/data/idea-inputs'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { GOAL_OPEN_CAP, GOAL_PROPOSE_KIND, GOAL_SEED_DAYS, parseGoalProposeText, type GoalCandidate } from '@/lib/kairos/goals/parse'
import { checkGoalPolicy } from '@/lib/kairos/goals/policy'
import {
  buildGoalProposePrompt,
  GOAL_PROPOSE_MAX_OUTPUT_TOKENS,
  GOAL_PROPOSE_SYSTEM_PROMPT,
  type GoalPromptSeed,
} from '@/lib/kairos/goals/prompt'
import { expireStaleGoals, proposeGoal } from '@/lib/kairos/goals/transitions'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { announceGoalProposal } from '@/lib/kairos/proposal-telegram'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { GOAL_PROPOSE_WINDOW_UTC, minutesLeftInWindow, utcDay } from '../deadlines'
import { errorReason } from './_errors'
import { goalProposeThoughts, withThoughts } from '../stage-thoughts'

// Kairos's own goal (Phase 2 initiative, Track A): at most one investigation
// goal a UTC night, seeded from ideas the owner accepted and goals that
// failed. plan: nothing unless KAIROS_INITIATIVE=1, inside the window, no job
// tonight, fewer than 2 open goals, and at least one seed. apply: strict parse
// → policy (fail-closed) → one locked write as a pending proposal that waits
// for the owner's Approve or Veto. No fallback: a missed night proposes none.

export const GOAL_PROPOSE_CRON = 'goal-propose'
export const GOAL_KAIROS_ACTOR = { kind: 'kairos', via: 'thinking:goal_propose' } as const

export const goalProposeJobKey = (day: string) => `${GOAL_PROPOSE_KIND}:${day}`

const contextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seeds: z.array(z.object({ id: z.string().min(1), kind: z.enum(['idea', 'failed_goal']) })),
  validDominionIds: z.array(z.string()),
  objectiveTitles: z.array(z.string()),
})
type GoalProposeContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): GoalProposeContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function gatherSeeds(userId: string, now: Date): Promise<GoalPromptSeed[]> {
  const [ideas, failed] = await Promise.all([
    listIdeaOutcomes(userId, GOAL_SEED_DAYS),
    listFailedGoals(userId, now, GOAL_SEED_DAYS),
  ])
  return [
    ...ideas.filter((i) => i.outcome === 'accepted').map((i): GoalPromptSeed => ({ id: i.id, kind: 'idea', title: i.title, text: i.claim })),
    ...failed.map((g): GoalPromptSeed => ({ id: g.id, kind: 'failed_goal', title: g.title, text: g.question })),
  ]
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!initiativeEnabled()) return []
  const deadlineMinutes = minutesLeftInWindow(now, GOAL_PROPOSE_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []

  await expireStaleGoals(userId, now)
  const date = utcDay(now)
  const externalKey = goalProposeJobKey(date)
  if (await hasJobWithKeyLike(userId, GOAL_PROPOSE_KIND, externalKey)) return []
  const open = await countOpenGoals(userId, now)
  if (open.active + open.pending >= GOAL_OPEN_CAP) return []

  const seeds = await gatherSeeds(userId, now)
  if (seeds.length === 0) return []

  const dominions = await listActiveDominions(userId)
  const [objectives, openGoals] = await Promise.all([listOpenObjectives(userId, dominions), listOpenGoals(userId, now)])
  const dominionName = new Map(dominions.map((d) => [d.id, d.name]))

  return [{
    kind: GOAL_PROPOSE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: GOAL_PROPOSE_SYSTEM_PROMPT,
      prompt: buildGoalProposePrompt({
        date,
        seeds,
        dominions,
        objectives: objectives.map((o) => ({ title: o.title, dominion: dominionName.get(o.dominionId) ?? '' })),
        openGoals: openGoals.map((g) => g.title),
      }),
      validMemoryIds: seeds.map((s) => s.id),
      maxOutputTokens: GOAL_PROPOSE_MAX_OUTPUT_TOKENS,
      context: {
        date,
        seeds: seeds.map((s) => ({ id: s.id, kind: s.kind })),
        validDominionIds: dominions.map((d) => d.id),
        objectiveTitles: objectives.map((o) => o.title),
      } satisfies GoalProposeContext,
    },
  }]
}

async function embedGoal(c: GoalCandidate): Promise<number[] | null> {
  try {
    return await embedOne(`${c.title}\n${c.question}`, 'document')
  } catch (err) {
    console.warn('[kairos:goal-propose] embed failed:', errorReason(err))
    return null
  }
}

async function skipped(job: ThinkingJobRow, reason: string, answeredBy: ThinkingAnsweredBy, detail?: string): Promise<ApplyOutcome> {
  await writeCronSuccessTrace(job.userId, {
    cronName: GOAL_PROPOSE_CRON,
    outcome: 'skipped',
    skipReason: reason,
    ...(detail ? { details: { detail } } : {}),
  })
  return { ok: true, memoryIds: [], output: { skipped: reason, ...(detail ? { detail } : {}), answeredBy } }
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: goal_propose job has no context' }
  const now = new Date()
  if (c.date !== utcDay(now)) return { ok: false, reason: `stale_job: planned for ${c.date}` }
  if (!initiativeEnabled()) return { ok: true, memoryIds: [], output: { skipped: 'initiative_off', answeredBy } }

  let candidate: GoalCandidate | null
  try {
    candidate = parseGoalProposeText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  if (!candidate) return skipped(job, 'no_goal', answeredBy)

  const embedding = await embedGoal(candidate)
  const similarities = embedding ? await listGoalSimilarities(job.userId, embedding, now) : null
  const verdict = checkGoalPolicy(candidate, {
    validSeedIds: new Set(c.seeds.map((s) => s.id)),
    validDominionIds: new Set(c.validDominionIds),
    openObjectiveTitles: c.objectiveTitles,
    nearestSimilarity: similarities ? Math.max(0, ...similarities.map((s) => s.similarity)) : null,
  })
  if (!verdict.ok) return skipped(job, verdict.reason, answeredBy, verdict.detail)

  const seedKind = new Map(c.seeds.map((s) => [s.id, s.kind]))
  const result = await proposeGoal(job.userId, GOAL_KAIROS_ACTOR, {
    candidate,
    seeds: candidate.seedIds.map((id) => ({ id, kind: seedKind.get(id) ?? 'idea' })),
    jobId: job.id,
    answeredBy,
    embedding,
    proposedOn: c.date,
    now,
  })
  if (!result.ok) return skipped(job, result.reason, answeredBy)

  // Ask first: the proposal goes to the owner's Telegram with Approve / Veto /
  // Veto + why, through the Kairos gate. Best-effort — the row in the inbox is the record.
  try {
    await announceGoalProposal(job.userId, result.goal, now)
  } catch (err) {
    console.error('[kairos:goal-propose] sending the proposal to Telegram failed:', errorReason(err))
  }

  await writeCronSuccessTrace(job.userId, { cronName: GOAL_PROPOSE_CRON, outcome: 'ok', details: { goalId: result.goal.id } })
  return withThoughts(
    { ok: true, memoryIds: [result.goal.id], output: { goalId: result.goal.id, answeredBy } },
    goalProposeThoughts(result.goal.title),
  )
}

export const goalProposeHandler: ThinkingJobHandler = {
  kind: GOAL_PROPOSE_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — none is fine' }),
}

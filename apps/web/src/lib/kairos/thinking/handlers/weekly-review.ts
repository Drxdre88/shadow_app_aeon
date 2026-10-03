import { z } from 'zod'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { captureMemory } from '@/lib/data/memories'
import { findCharacterRun } from '@/lib/data/character'
import { characterCheckEnabled } from '@/lib/kairos/character/flag'
import { characterLine, readCharacterRun } from '@/lib/kairos/character/rubric'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { loadConscienceBlock } from '@/lib/kairos/conscience-context'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import { sendMessage, telegramConfigured } from '@/lib/kairos/telegram'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { createKairosPromises, type CreatePromisesResult } from '@/lib/kairos/promises/create'
import { dueWindow } from '@/lib/kairos/promises/rules'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { createKairosPredictions, type CreatePredictionsResult } from '@/lib/kairos/predictions/create'
import { predictionsEnabled } from '@/lib/kairos/predictions/flag'
import { buildReviewPredictionContext, type ReviewPredictionContext } from '@/lib/kairos/predictions/prompt-block'
import {
  fedMemoryIds,
  gatherWeeklyReviewInputs,
  hasReviewSignal,
  reviewWindow,
} from '@/lib/kairos/weekly-review/inputs'
import {
  WEEKLY_REVIEW_SYSTEM_PROMPT,
  buildWeeklyReviewPrompt,
  parseWeeklyReviewText,
  type GroundedWeeklyReview,
  type ReviewPromiseContext,
} from '@/lib/kairos/weekly-review/prompt'
import {
  renderReviewActionBody,
  renderWeeklyReviewMarkdown,
  renderWeeklyReviewMessage,
  weeklyReviewTitle,
} from '@/lib/kairos/weekly-review/render'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { askPaidAndParse } from '../paid-fallback'
import { errorReason } from './_errors'
import { weeklyReviewThoughts, withThoughts } from '../stage-thoughts'

// Weekly review on the thinking queue (docs/kairos/34 §4). plan: Mondays
// (UTC) from 05:00Z, one user-wide job per ISO week, over a fixed set of
// inputs for the week that just ended. apply: strict parse + grounding, then
// ≤5 review-action PROPOSALS, one `weekly_review` observation, and one spoken
// summary (digest register). Every write is idempotent per week. fallback: the
// hourly sweep's paid heavy-tier call + one repair round-trip.

export const WEEKLY_REVIEW_KIND: ThinkingJobKind = 'weekly_review'
export const WEEKLY_REVIEW_PLAN_HOUR_UTC = 5
export const WEEKLY_REVIEW_DEADLINE_MINUTES = 6 * 60
export const WEEKLY_REVIEW_MAX_OUTPUT_TOKENS = 3000
const CRON_NAME = 'weekly-review'
const MAX_LINKS = 100

export const weeklyReviewJobKey = (isoWeek: string) => `weekly_review:${isoWeek}`
export const weeklyReviewSpeakId = (isoWeek: string) => `kairos-weekly:${isoWeek}`
const observationExternalId = (isoWeek: string) => `weekly-review:${isoWeek}`
const actionExternalId = (isoWeek: string, i: number) => `weekly-review:${isoWeek}:action:${i}`

export function isWeeklyReviewDue(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getUTCHours() >= WEEKLY_REVIEW_PLAN_HOUR_UTC
}

const contextSchema = z.object({
  isoWeek: z.string().min(1),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  dominions: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  inputErrors: z.array(z.string()).default([]),
  // KAIROS_PREDICTIONS: the code-built track-record line, fixed at plan time.
  trackRecordLine: z.string().max(400).nullable().optional(),
})

export type WeeklyReviewJobContext = z.infer<typeof contextSchema>

async function planWeeklyReview(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!isWeeklyReviewDue(now)) return []
  const { isoWeek } = reviewWindow(now)
  const externalKey = weeklyReviewJobKey(isoWeek)
  // Once per week: the claim path re-plans on every claim, so skip the input
  // gather entirely once this week's job exists in any status.
  if (await hasJobWithKeyLike(userId, WEEKLY_REVIEW_KIND, externalKey)) return []

  const inputs = await gatherWeeklyReviewInputs(userId, now)
  if (!hasReviewSignal(inputs)) return []
  // The paid fallback re-sends job.input.prompt, so both paths get this block.
  const conscience = await loadConscienceBlock(userId)
  const promises = initiativeEnabled() ? await reviewPromiseContext(userId, now) : undefined
  const predictions = predictionsEnabled() ? await reviewPredictionContext(userId, now) : undefined

  const context: WeeklyReviewJobContext = {
    isoWeek,
    windowStart: inputs.window.start.toISOString(),
    windowEnd: inputs.window.end.toISOString(),
    dominions: inputs.dominions,
    inputErrors: inputs.errors,
    ...(predictions ? { trackRecordLine: predictions.trackRecordLine } : {}),
  }
  return [{
    kind: WEEKLY_REVIEW_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: WEEKLY_REVIEW_DEADLINE_MINUTES,
    input: {
      system: WEEKLY_REVIEW_SYSTEM_PROMPT,
      prompt: buildWeeklyReviewPrompt(inputs, conscience, promises, predictions),
      validMemoryIds: fedMemoryIds(inputs),
      context,
      maxOutputTokens: WEEKLY_REVIEW_MAX_OUTPUT_TOKENS,
    },
  }]
}

async function reviewPromiseContext(userId: string, now: Date): Promise<ReviewPromiseContext | undefined> {
  try {
    const state = await readKairosPromises(userId)
    return { ...dueWindow(now), open: state.open.map((p) => ({ seq: p.seq, outcome: p.outcome, dueDate: p.dueDate })) }
  } catch (err) {
    console.warn('[kairos:weekly-review] promise read failed — no promises this week:', errorReason(err))
    return undefined
  }
}

async function reviewPredictionContext(userId: string, now: Date): Promise<ReviewPredictionContext | undefined> {
  try {
    return buildReviewPredictionContext(await readKairosPredictions(userId), now)
  } catch (err) {
    console.warn('[kairos:weekly-review] prediction read failed — no predictions this week:', errorReason(err))
    return undefined
  }
}

// KAIROS_PREDICTIONS only: the review's predictions go through the one
// server-side creator (strict re-validation, grounding, caps). Never costs the review.
async function persistReviewPredictions(
  job: ThinkingJobRow,
  ctx: WeeklyReviewJobContext,
  review: GroundedWeeklyReview,
): Promise<CreatePredictionsResult | null> {
  if (!predictionsEnabled() || review.predictions.length === 0) return null
  try {
    return await createKairosPredictions(
      job.userId,
      review.predictions,
      { kind: 'weekly_review', jobId: job.id, isoWeek: ctx.isoWeek },
      { validMemoryIds: job.input.validMemoryIds ?? [], dominions: ctx.dominions },
    )
  } catch (err) {
    await writeCronFailureTrace(job.userId, { cronName: CRON_NAME, reason: 'predictions_failed', error: err })
    return null
  }
}

// Initiative only: the review's promises go through the one server-side
// creator (validation, caps, status forced open). Never costs the review.
async function persistReviewPromises(
  job: ThinkingJobRow,
  isoWeek: string,
  review: GroundedWeeklyReview,
): Promise<CreatePromisesResult | null> {
  if (!initiativeEnabled() || review.promises.length === 0) return null
  try {
    return await createKairosPromises(job.userId, review.promises, { kind: 'weekly_review', jobId: job.id, isoWeek })
  } catch (err) {
    await writeCronFailureTrace(job.userId, { cronName: CRON_NAME, reason: 'promises_failed', error: err })
    return null
  }
}

function readContext(job: ThinkingJobRow): WeeklyReviewJobContext | null {
  const parsed = contextSchema.safeParse(job.input.context)
  return parsed.success ? parsed.data : null
}

// KAIROS_CHARACTER_CHECK only: the week's character-check line, built in code
// from the stored run (scores never reach the review prompt). Never costs the review.
async function characterExtraLines(userId: string, isoWeek: string): Promise<string[]> {
  if (!characterCheckEnabled()) return []
  try {
    const row = await findCharacterRun(userId, isoWeek)
    const run = row ? readCharacterRun(row.sourceMetadata) : null
    return run ? [characterLine(run)] : []
  } catch (err) {
    console.warn('[kairos:weekly-review] character check read failed — no line this week:', errorReason(err))
    return []
  }
}

async function sendCharacterLines(userId: string, lines: readonly string[]): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID
  if (lines.length === 0 || !chatId || !telegramConfigured() || userId !== process.env.KAIROS_OPERATOR_USER_ID) return
  try {
    await sendMessage(chatId, lines.join('\n'))
  } catch (err) {
    console.warn('[kairos:weekly-review] character line not sent:', errorReason(err))
  }
}

const refersTo = (target: string) => ({ type: 'refers_to' as const, target, target_kind: 'memory' as const })

async function deliverSummary(
  userId: string,
  isoWeek: string,
  message: string,
): Promise<'delivered' | 'already_delivered' | 'blocked'> {
  try {
    // force mirrors the evening digest: a once-a-week fixed register must not
    // be swallowed by a pending ask's awaiting-reply gate; the externalId keeps
    // it to exactly one fan-out per week whatever re-applies.
    const outcome = await deliverKairosSpeak(userId, {
      title: weeklyReviewTitle(isoWeek),
      message,
      kind: 'notify',
      urgency: 'normal',
      force: true,
      opsAlert: false,
      digest: true,
      externalId: weeklyReviewSpeakId(isoWeek),
    })
    if (outcome.status === 200) return outcome.body.alreadyDelivered ? 'already_delivered' : 'delivered'
    await writeCronFailureTrace(userId, {
      cronName: CRON_NAME,
      reason: 'delivery_blocked',
      rawExcerpt: JSON.stringify(outcome.body).slice(0, 500),
    })
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'delivery_failed', error: err })
  }
  return 'blocked'
}

async function persistWeeklyReview(
  job: ThinkingJobRow,
  ctx: WeeklyReviewJobContext,
  review: GroundedWeeklyReview,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const { isoWeek } = ctx
  const proposalIds: string[] = []
  for (const [i, action] of review.actions.entries()) {
    const { memory } = await captureMemory(job.userId, {
      title: action.title.slice(0, 255),
      bodyMd: renderReviewActionBody(action, isoWeek),
      summary: action.why.slice(0, 1000),
      type: 'inbound',
      source: 'cron',
      // Kairos's own suggestion — weighted below the operator until accepted.
      streamClass: 'agentic',
      dominionId: action.dominionId,
      links: action.evidenceIds.map(refersTo),
      tags: ['proposal', 'review_action'],
      sourceMetadata: {
        // introspection:true makes it a first-class proposal (inbox + accept).
        introspection: true,
        kind: 'review_action',
        status: 'pending',
        citations: action.evidenceIds,
        why: action.why,
        isoWeek,
        jobId: job.id,
        answeredBy,
        externalId: actionExternalId(isoWeek, i),
      },
    })
    proposalIds.push(memory.id)
  }

  const promised = await persistReviewPromises(job, isoWeek, review)
  const predicted = await persistReviewPredictions(job, ctx, review)
  const trackRecordLine = predictionsEnabled() ? ctx.trackRecordLine ?? null : null
  // Read at apply time, so a character check finishing after this review was
  // planned still shows.
  const extraLines = await characterExtraLines(job.userId, isoWeek)

  const evidence = [...new Set(review.actions.flatMap((a) => a.evidenceIds))]
  const { memory: observation } = await captureMemory(job.userId, {
    title: weeklyReviewTitle(isoWeek),
    bodyMd: renderWeeklyReviewMarkdown(review, isoWeek, trackRecordLine),
    summary: review.summary.slice(0, 1000),
    type: 'observation',
    source: 'cron',
    streamClass: 'agentic',
    dominionId: null,
    links: [...proposalIds, ...evidence].slice(0, MAX_LINKS).map(refersTo),
    tags: ['weekly_review'],
    sourceMetadata: {
      kind: 'weekly_review',
      externalId: observationExternalId(isoWeek),
      isoWeek,
      window: { start: ctx.windowStart, end: ctx.windowEnd },
      summary: review.summary,
      wins: review.wins,
      drift: review.drift,
      actions: review.actions.map((a, i) => ({ ...a, proposalId: proposalIds[i] ?? null })),
      droppedActions: review.droppedActions,
      proposalIds,
      inputErrors: ctx.inputErrors,
      jobId: job.id,
      answeredBy,
      ...(promised ? {
        promises: {
          created: promised.created.map((p) => ({ id: p.id, seq: p.seq, dueDate: p.dueDate })),
          rejected: promised.rejected,
          overflow: promised.overflow,
        },
      } : {}),
      ...(predicted ? {
        predictions: {
          created: predicted.created.map((p) => ({ id: p.id, seq: p.seq, dueDate: p.dueDate, probability: p.probability })),
          rejected: predicted.rejected,
          overflow: predicted.overflow,
        },
      } : {}),
    },
  })

  const delivery = await deliverSummary(job.userId, isoWeek, renderWeeklyReviewMessage(review, proposalIds.length, trackRecordLine))
  // The character line is measurement only: it goes to the owner's Telegram
  // and never into the stored review, the spoken message or the today log,
  // so no Kairos prompt can ever see his own scores.
  if (delivery === 'delivered') await sendCharacterLines(job.userId, extraLines)
  if (delivery === 'blocked') console.warn('[kairos:weekly-review] summary not delivered', { isoWeek, jobId: job.id })
  return withThoughts({ ok: true, memoryIds: [observation.id, ...proposalIds] }, weeklyReviewThoughts(review.summary))
}

function parseFor(ctx: WeeklyReviewJobContext, job: ThinkingJobRow) {
  const validIds = new Set(job.input.validMemoryIds ?? [])
  return (text: string) => parseWeeklyReviewText(text, validIds, ctx.dominions)
}

export async function applyWeeklyReview(
  job: ThinkingJobRow,
  text: string,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid weekly_review job context' }
  let review: GroundedWeeklyReview
  try {
    review = parseFor(ctx, job)(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persistWeeklyReview(job, ctx, review, answeredBy)
}

export async function fallbackWeeklyReview(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid weekly_review job context' }
  const res = await askPaidAndParse(job, {
    parse: parseFor(ctx, job),
    label: 'weekly-review',
    maxTokens: job.input.maxOutputTokens ?? WEEKLY_REVIEW_MAX_OUTPUT_TOKENS,
    repairContext: [
      'Valid evidence ids — cite these verbatim in evidenceIds:',
      ...(job.input.validMemoryIds ?? []).map((id) => `- ${id}`),
      `Valid dominion names: ${ctx.dominions.map((d) => d.name).join(', ') || '(none — use null)'}`,
    ].join('\n'),
    reasonPrefix: 'parse_failed: ',
  })
  if (!res.ok) return res
  return persistWeeklyReview(job, ctx, res.value, 'api')
}

export const weeklyReviewHandler: ThinkingJobHandler = {
  kind: WEEKLY_REVIEW_KIND,
  plan: planWeeklyReview,
  apply: applyWeeklyReview,
  fallback: fallbackWeeklyReview,
}

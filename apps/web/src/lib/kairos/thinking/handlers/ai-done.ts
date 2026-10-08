import { writeAiDoneCards } from '@/lib/data/ai-done'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { aiDoneEnabled } from '@/lib/kairos/ai-done/flag'
import { gatherAiDone } from '@/lib/kairos/ai-done/gather'
import { groundAiDone } from '@/lib/kairos/ai-done/ground'
import { AI_DONE_MAX_OUTPUT_TOKENS, AI_DONE_SYSTEM_PROMPT, buildAiDoneJob, parseAiDoneText } from '@/lib/kairos/ai-done/prompt'
import { AI_DONE_KIND, aiDoneContextSchema, type AiDoneAnswer } from '@/lib/kairos/ai-done/types'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobHandler, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { londonDateHour } from '../deadlines'
import { errorReason } from './_errors'

// AI DONE (KAIROS_AI_DONE + per-board settings.kairosAiDone, deep tier, brain
// routine, DAILY). plan: one job per user per London day (key
// ai_done:<London date>), only from 16:00 to 17:59 London, when a switched-on
// board has today's core-repo sessions not yet on it; deadline 18:30 London.
// apply grounds the cards and files them ticked-but-not-done in each board's
// AI DONE column. No fallback: a missed afternoon is skipped, never paid.

export const AI_DONE_WINDOW_LONDON = { fromHour: 16, toHour: 17 }
export const AI_DONE_DEADLINE_LONDON = { hour: 18, minute: 30 }

export const aiDoneJobKey = (londonDate: string) => `${AI_DONE_KIND}:${londonDate}`

/** Minutes from now to 18:30 London; <= 0 outside the 16:00–17:59 London window. */
export function aiDoneMinutesLeft(now: Date): number {
  const { hour, minute } = londonDateHour(now)
  if (hour < AI_DONE_WINDOW_LONDON.fromHour || hour > AI_DONE_WINDOW_LONDON.toHour) return 0
  return AI_DONE_DEADLINE_LONDON.hour * 60 + AI_DONE_DEADLINE_LONDON.minute - (hour * 60 + minute)
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!aiDoneEnabled()) return []
  const deadlineMinutes = aiDoneMinutesLeft(now)
  if (deadlineMinutes <= 0) return []
  const externalKey = aiDoneJobKey(londonDateHour(now).date)
  if (await hasJobWithKeyLike(userId, AI_DONE_KIND, externalKey)) return []

  const input = await gatherAiDone(userId, now)
  if (!input) return []
  const { prompt, context } = buildAiDoneJob(input)
  return [{
    kind: AI_DONE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: { system: AI_DONE_SYSTEM_PROMPT, prompt, validMemoryIds: [], context, maxOutputTokens: AI_DONE_MAX_OUTPUT_TOKENS },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = aiDoneContextSchema.safeParse(job.input?.context)
  if (!ctx.success) return { ok: false, reason: `bad_job: ${errorReason(ctx.error)}` }
  if (!aiDoneEnabled()) return { ok: true, memoryIds: [], output: { skipped: 'switched_off', answeredBy } }

  let answer: AiDoneAnswer
  try {
    answer = parseAiDoneText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const grounded = groundAiDone(answer, ctx.data)
  const boards: Record<string, string | number> = {}
  let cards = 0
  for (const board of grounded.boards) {
    const written = await writeAiDoneCards({ projectId: board.projectId, userId: job.userId, jobId: job.id, day: ctx.data.day, cards: board.cards })
    boards[board.projectId] = written.status === 'written' ? written.created.length : written.status
    if (written.status === 'written') cards += written.created.length
  }
  return { ok: true, memoryIds: [], output: { cards, boards, dropped: grounded.dropped, answeredBy } }
}

export const aiDoneHandler: ThinkingJobHandler = {
  kind: AI_DONE_KIND,
  plan,
  apply,
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — the day is skipped' }),
}

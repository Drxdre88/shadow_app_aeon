import { insertCardGardenProposal } from '@/lib/data/card-garden-proposals'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { announceCardGarden } from '@/lib/kairos/card-garden/announce'
import { cardGardenMode } from '@/lib/kairos/card-garden/flag'
import { gatherCardGardenCandidates } from '@/lib/kairos/card-garden/gather'
import { groundCardGarden } from '@/lib/kairos/card-garden/ground'
import { buildCardGardenJob, CARD_GARDEN_MAX_OUTPUT_TOKENS, CARD_GARDEN_SYSTEM_PROMPT, parseCardGardenText } from '@/lib/kairos/card-garden/prompt'
import { cardGardenTitle, renderCardGardenBody } from '@/lib/kairos/card-garden/render'
import { CARD_GARDEN_EXPIRY_MS, CARD_GARDEN_KIND, cardGardenContextSchema, type CardGardenAnswer } from '@/lib/kairos/card-garden/types'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobHandler, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { deadlineOn, isoWeekKey } from '../deadlines'
import { errorReason } from './_errors'

// Card garden (Workforce Phase 3, deep tier, brain routine, WEEKLY). plan:
// only with KAIROS_CARD_GARDEN on, Mondays from 06:00Z, one job per ISO week
// (key card_garden:<isoWeek>), over ≤25 stale cards on boards the owner can
// edit. apply grounds ≤10 picks (ids from the context only) and files each as
// its own PENDING proposal for 7 days, announced through the gated proposal
// path. It never touches a card — only the owner's Approve does. No fallback:
// a missed week is fine, never paid.

export const CARD_GARDEN_CRON = 'card-garden'
export const CARD_GARDEN_NOT_BEFORE_UTC = { hour: 6, minute: 0 }
export const CARD_GARDEN_DEADLINE_MINUTES = 18 * 60

export const cardGardenJobKey = (isoWeek: string) => `${CARD_GARDEN_KIND}:${isoWeek}`

export function isCardGardenDue(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getTime() >= deadlineOn(now, CARD_GARDEN_NOT_BEFORE_UTC).getTime()
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (cardGardenMode() === 'off' || !isCardGardenDue(now)) return []
  const isoWeek = isoWeekKey(now)
  const externalKey = cardGardenJobKey(isoWeek)
  if (await hasJobWithKeyLike(userId, CARD_GARDEN_KIND, externalKey)) return []

  const { boards, cards } = await gatherCardGardenCandidates(userId, now)
  if (cards.length === 0) return []
  const { prompt, context } = buildCardGardenJob({ isoWeek, boards, cards })
  return [{
    kind: CARD_GARDEN_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: CARD_GARDEN_DEADLINE_MINUTES,
    input: { system: CARD_GARDEN_SYSTEM_PROMPT, prompt, validMemoryIds: [], context, maxOutputTokens: CARD_GARDEN_MAX_OUTPUT_TOKENS },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = cardGardenContextSchema.safeParse(job.input?.context)
  if (!ctx.success) return { ok: false, reason: 'bad_job: card_garden job has no context' }

  let answer: CardGardenAnswer
  try {
    answer = parseCardGardenText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const grounded = groundCardGarden(answer, ctx.data)
  if (!grounded.ok) {
    await writeCronSuccessTrace(job.userId, { cronName: CARD_GARDEN_CRON, outcome: 'skipped', skipReason: grounded.reason })
    return { ok: true, memoryIds: [], output: { skipped: grounded.reason, answeredBy } }
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + CARD_GARDEN_EXPIRY_MS).toISOString()
  const ids: string[] = []
  for (const pick of grounded.picks) {
    const title = cardGardenTitle(pick)
    const { id, written } = await insertCardGardenProposal(job.userId, {
      externalKey: `${CARD_GARDEN_KIND}:${pick.isoWeek}:${pick.taskId}`,
      title,
      bodyMd: renderCardGardenBody(pick),
      pick,
      expiresAt,
      jobId: job.id,
      now,
    })
    ids.push(id)
    if (!written) continue
    try {
      await announceCardGarden(job.userId, { id, title, expiresAt, pick }, now)
    } catch (err) {
      console.error('[kairos:card-garden] sending the proposal to Telegram failed:', errorReason(err))
    }
  }

  await writeCronSuccessTrace(job.userId, {
    cronName: CARD_GARDEN_CRON,
    outcome: 'ok',
    details: { isoWeek: ctx.data.isoWeek, proposals: ids.length, dropped: grounded.dropped },
  })
  return { ok: true, memoryIds: ids, output: { proposals: ids.length, dropped: grounded.dropped, answeredBy } }
}

export const cardGardenHandler: ThinkingJobHandler = {
  kind: CARD_GARDEN_KIND,
  plan,
  apply,
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — a missed week is fine' }),
}

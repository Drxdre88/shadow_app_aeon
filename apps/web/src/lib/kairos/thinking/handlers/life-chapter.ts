import { z } from 'zod'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import type { LifeChapterMeta } from '@/lib/data/validators/kairos-life-chapters'
import { lifeChapterLineOn, lifeChapterMode } from '@/lib/kairos/life-chapters/flag'
import { citableIds, gatherLifeChapterInputs, hasChapterSignal, inputCounts } from '@/lib/kairos/life-chapters/inputs'
import {
  LIFE_CHAPTER_MAX_OUTPUT_TOKENS,
  LIFE_CHAPTER_SYSTEM_PROMPT,
  buildLifeChapterPrompt,
  lintChapter,
  parseLifeChapterText,
  type ParsedLifeChapter,
} from '@/lib/kairos/life-chapters/prompt'
import { renderChapterNotice, renderLifeChapterMarkdown } from '@/lib/kairos/life-chapters/render'
import { LIFE_CHAPTER_DEADLINE_MINUTES, isLifeChapterDue, previousMonthWindow } from '../deadlines'
import { errorReason } from './_errors'

// Life chapter (wave 4 lane E, deep tier, brain routine). plan: only with
// KAIROS_LIFE_CHAPTERS observe|1 (off returns [] before any read), UTC days
// 1–3 from 12:00Z, one job per previous UTC month (key life_chapter:<YYYY-MM>,
// 36h deadline), skipped under 3 citable ids. apply: strict parse, items
// whose ids do not ground are dropped, rejected only when nothing grounds;
// one idempotent `life_chapter` trace row. Mode 1 + KAIROS_LIFE_CHAPTER_LINE
// adds one Telegram notice (force:false, so every speak limit applies). No
// fallback — a missed month is skipped, never paid. lib/data and speak are
// imported lazily, so the off path opens no DB module.

export const LIFE_CHAPTER_KIND: ThinkingJobKind = 'life_chapter'

export const lifeChapterJobKey = (month: string) => `life_chapter:${month}`
export const lifeChapterSpeakId = (month: string) => `kairos-chapter:${month}`

const contextSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  inputCounts: z.record(z.string(), z.number().int().min(0)),
})
type LifeChapterContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): LifeChapterContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (lifeChapterMode() === 'off' || !isLifeChapterDue(now)) return []
  const window = previousMonthWindow(now)
  const externalKey = lifeChapterJobKey(window.month)
  const { hasJobWithKeyLike } = await import('@/lib/data/thinking-jobs')
  if (await hasJobWithKeyLike(userId, LIFE_CHAPTER_KIND, externalKey)) return []

  const inputs = await gatherLifeChapterInputs(userId, window)
  if (!hasChapterSignal(inputs)) return []
  return [{
    kind: LIFE_CHAPTER_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: LIFE_CHAPTER_DEADLINE_MINUTES,
    input: {
      system: LIFE_CHAPTER_SYSTEM_PROMPT,
      prompt: buildLifeChapterPrompt(inputs),
      validMemoryIds: citableIds(inputs),
      maxOutputTokens: LIFE_CHAPTER_MAX_OUTPUT_TOKENS,
      context: {
        month: window.month,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        inputCounts: inputCounts(inputs),
      } satisfies LifeChapterContext,
    },
  }]
}

// Mode 1 + line flag only, after a new row. force:false: the awaiting-reply
// gate and gap/day caps apply; a blocked notice is logged and the chapter
// stays readable.
async function sendNotice(userId: string, month: string, c: ParsedLifeChapter): Promise<'delivered' | 'blocked' | 'failed'> {
  try {
    const { deliverKairosSpeak } = await import('@/lib/kairos/speak')
    const notice = renderChapterNotice(month, c)
    const outcome = await deliverKairosSpeak(userId, {
      ...notice,
      kind: 'notify',
      urgency: 'low',
      force: false,
      opsAlert: false,
      digest: false,
      externalId: lifeChapterSpeakId(month),
    })
    if (outcome.status === 200) return 'delivered'
    console.warn('[kairos:life-chapter] notice held back by speak limits', { month })
    return 'blocked'
  } catch (err) {
    console.warn('[kairos:life-chapter] notice not sent:', errorReason(err))
    return 'failed'
  }
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid life_chapter context' }
  if (lifeChapterMode() === 'off') return { ok: true, memoryIds: [], output: { skipped: 'life_chapters_off', answeredBy } }

  const data = await import('@/lib/data/life-chapters')
  const done = await data.findLifeChapter(job.userId, ctx.month)
  if (done) return { ok: true, memoryIds: [done.id], output: { alreadyRecorded: true, answeredBy } }

  let parsed: ParsedLifeChapter
  try {
    parsed = parseLifeChapterText(text, new Set(job.input.validMemoryIds ?? []))
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  if (parsed.turningPoints.length === 0 && parsed.whatChanged.length === 0) {
    return { ok: false, reason: `ungrounded: no turning point or change cites a listed id (dropped ${parsed.dropped})` }
  }

  const citations = [...new Set([...parsed.turningPoints, ...parsed.whatChanged].flatMap((i) => i.evidenceIds))]
  const lintHits = lintChapter(parsed)
  const chapter: LifeChapterMeta = {
    v: 1,
    month: ctx.month,
    window: { start: ctx.windowStart, end: ctx.windowEnd },
    title: parsed.title,
    summary: parsed.summary,
    turningPoints: parsed.turningPoints,
    whatChanged: parsed.whatChanged,
    unresolved: parsed.unresolved,
    citations,
    inputCounts: ctx.inputCounts,
    lintHits,
    jobId: job.id,
    answeredBy,
  }
  const res = await data.insertLifeChapter(job.userId, {
    month: ctx.month,
    title: `Life chapter · ${ctx.month} — ${parsed.title}`,
    bodyMd: renderLifeChapterMarkdown(ctx.month, parsed),
    summary: parsed.summary || parsed.title,
    chapter,
  })
  const notice = res.written && lifeChapterLineOn() ? await sendNotice(job.userId, ctx.month, parsed) : null
  return {
    ok: true,
    memoryIds: [res.memoryId],
    output: {
      month: ctx.month,
      turningPoints: parsed.turningPoints.length,
      whatChanged: parsed.whatChanged.length,
      unresolved: parsed.unresolved.length,
      dropped: parsed.dropped,
      ...(res.written ? {} : { alreadyRecorded: true }),
      ...(notice ? { notice } : {}),
      answeredBy,
    },
  }
}

async function fallback(): Promise<ApplyOutcome> {
  return { ok: false, reason: 'no fallback — a missed month is fine' }
}

export const lifeChapterHandler: ThinkingJobHandler = {
  kind: LIFE_CHAPTER_KIND,
  plan,
  apply,
  fallback,
}
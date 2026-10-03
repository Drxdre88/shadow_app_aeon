import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listRecentMemories } from '@/lib/data/memories'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import {
  PULSE_MAX_OUTPUT_TOKENS,
  PULSE_SYSTEM_PROMPT,
  buildPulsePrompt,
  parsePulseText,
  renderPulseNotes,
} from '@/lib/kairos/cadence/pulse-prompt'
import { daytimeThinkingEnabled, hasOwnerActivitySince, lastLookedAt, listDaytimeJobsToday } from '@/lib/kairos/cadence/signal'
import { appendTodayNotes, loadTodayDigest, todayEnabled } from '@/lib/kairos/today'
import { renderTodaySection } from '@/lib/kairos/today-render'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { PULSE_DEADLINE_MINUTES, PULSE_WINDOW_LONDON, daytimeSlotKey, inLondonHours, londonClockLabel } from '../deadlines'
import { errorReason } from './_errors'

// Pulse (spec A, light tier, pulse routine). plan: nothing unless
// KAIROS_DAYTIME_THINKING=1 and the today module is on, inside 07–22 London,
// one job per London hour, and only when the owner (or their agents) did
// something since the last pulse. apply: ONLY appendTodayNotes — it never
// writes memories and never speaks. No fallback: a missed hour is fine.

export const PULSE_KIND: ThinkingJobKind = 'pulse'
const TODAY_PROMPT_CHARS = 5000
const INBOX_LIMIT = 8
const INBOX_WINDOW_MS = 24 * 60 * 60 * 1000

const contextSchema = z.object({
  slot: z.string().min(1),
  inbox: z.array(z.object({ id: z.string().min(1), title: z.string() })),
})
type PulseContext = z.infer<typeof contextSchema>

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!daytimeThinkingEnabled() || !todayEnabled()) return []
  if (!inLondonHours(now, PULSE_WINDOW_LONDON)) return []
  const externalKey = daytimeSlotKey(PULSE_KIND, now)
  if (await hasJobWithKeyLike(userId, PULSE_KIND, externalKey)) return []

  const since = lastLookedAt(await listDaytimeJobsToday(userId, PULSE_KIND, now), now)
  if (!(await hasOwnerActivitySince(userId, since, now))) return []

  const [digest, inboxRows] = await Promise.all([
    loadTodayDigest(userId, { hours: 16, limit: 80 }),
    listRecentMemories(
      userId,
      [and(eq(memories.type, 'inbound'), isNull(memories.archivedAt))!],
      { start: new Date(now.getTime() - INBOX_WINDOW_MS), end: now },
      INBOX_LIMIT,
    ),
  ])
  const inbox = inboxRows.map((m) => ({ id: m.id, title: m.title }))

  return [{
    kind: PULSE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: PULSE_DEADLINE_MINUTES,
    input: {
      system: PULSE_SYSTEM_PROMPT,
      prompt: buildPulsePrompt({
        londonTime: londonClockLabel(now),
        since: `${londonClockLabel(since)} London`,
        todaySection: renderTodaySection(digest, { maxChars: TODAY_PROMPT_CHARS, heading: 'Today so far' }),
        inbox,
      }),
      validMemoryIds: inbox.map((m) => m.id),
      maxOutputTokens: PULSE_MAX_OUTPUT_TOKENS,
      context: { slot: externalKey, inbox } satisfies PulseContext,
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const parsedCtx = contextSchema.safeParse(job.input?.context)
  if (!parsedCtx.success) return { ok: false, reason: 'bad_job: pulse job has no context' }
  const ctx = parsedCtx.data
  if (!daytimeThinkingEnabled()) return { ok: true, memoryIds: [], output: { skipped: 'daytime_off', answeredBy } }
  // No today module → nowhere to write; the pulse writes nothing else.
  if (!todayEnabled()) return { ok: true, memoryIds: [], output: { skipped: 'today_off', answeredBy } }

  let out
  try {
    out = parsePulseText(text, new Set(ctx.inbox.map((m) => m.id)))
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const lines = renderPulseNotes(out, new Map(ctx.inbox.map((m) => [m.id, m.title])))
  if (lines.length > 0) await appendTodayNotes(job.userId, lines, 'pulse', job.id)
  return {
    ok: true,
    memoryIds: [],
    output: { notes: out.notes.length, attention: out.attention.map((a) => a.memoryId), dropped: out.dropped, answeredBy },
  }
}

export const pulseHandler: ThinkingJobHandler = {
  kind: PULSE_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed hour is fine' }),
}

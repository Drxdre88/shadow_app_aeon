import { listJobs } from '@/lib/data/thinking-jobs'
import {
  DAILY_MESSAGE_KIND,
  alreadyDelivered,
  dailyMessageJobKey,
} from '@/lib/kairos/daily-message'
import { gatherDailyMessageInputs, readTodayBriefs } from '@/lib/kairos/daily-message-inputs'
import { loadConscienceBlock } from '@/lib/kairos/conscience-context'
import {
  DAILY_MESSAGE_SYSTEM_PROMPT,
  buildDailyMessageUserPrompt,
  londonDate,
  londonInstant,
  parseDailyMessageDraft,
} from '@/lib/kairos/daily-message-prompt'
import type {
  ApplyOutcome,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, minutesUntil, utcDayStart } from '../deadlines'

// Daily message on the thinking queue (docs/kairos/34 §3): one job per user
// per London date, planned once today's briefs exist, with exactly the compose
// prompt the daily-message cron would send on the paid key. The deadline is
// 07:55 London (5 min before delivery). apply only guards the draft and
// returns it as `output.draft` (the queue merges it into the completed job's
// output) — the 08:00 London cron delivers it. Fallback = that cron (paid
// key, then deterministic); the sweep only marks the job expired.

const DEADLINE_LEAD_MS = 5 * 60_000
// The 06:15 briefer fills any brief the routine missed; give it 10 minutes.
export const BRIEFS_SETTLED_UTC = { hour: 6, minute: 25 }

export function dailyMessageDeadline(now: Date): Date {
  return new Date(londonInstant(londonDate(now)).getTime() - DEADLINE_LEAD_MS)
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesUntil(now, dailyMessageDeadline(now))
  if (deadlineMinutes <= 0) return []

  const date = londonDate(now)
  const key = dailyMessageJobKey(date)
  const jobs = await listJobs(userId, { kind: DAILY_MESSAGE_KIND, since: new Date(now.getTime() - 2 * 86_400_000), limit: 10 })
  if (jobs.some((j) => j.externalKey === key)) return []
  if (await alreadyDelivered(userId, date)) return []
  // Briefs on the queue land one at a time and the prompt is frozen at
  // planning: wait until every brief job is answered, or until the 06:15
  // briefer has filled the gaps — never plan on a partial set.
  const briefJobs = await listJobs(userId, { kind: 'brief', since: utcDayStart(now), limit: 50 })
  if (briefJobs.some((j) => j.status !== 'done') && now.getTime() < deadlineOn(now, BRIEFS_SETTLED_UTC).getTime()) return []
  // Cheap prerequisite read first: the hourly sweep plans this kind too, so
  // the full input gather runs only once today's briefs exist.
  if ((await readTodayBriefs(userId, date)).length === 0) return []

  const inputs = await gatherDailyMessageInputs(userId, now)
  if (!inputs.briefs || inputs.briefs.length === 0) return []
  // Same block the paid compose sends (daily-message.ts) — '' on failure.
  const conscience = await loadConscienceBlock(userId)

  return [{
    kind: DAILY_MESSAGE_KIND,
    dominionId: null,
    externalKey: key,
    deadlineMinutes,
    input: {
      system: DAILY_MESSAGE_SYSTEM_PROMPT,
      prompt: buildDailyMessageUserPrompt(inputs, conscience),
      maxOutputTokens: 1500,
      context: { date },
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string): Promise<ApplyOutcome> {
  const date = typeof job.input?.context?.date === 'string' ? job.input.context.date : null
  if (!date) return { ok: false, reason: 'bad_job: daily_message job has no date context' }
  if (date !== londonDate(new Date())) return { ok: false, reason: `stale_job: planned for ${date}` }

  const parsed = parseDailyMessageDraft(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, memoryIds: [], output: { draft: parsed.message } }
}

export const dailyMessageHandler: ThinkingJobHandler = {
  kind: DAILY_MESSAGE_KIND,
  plan,
  apply,
  // The 08:00 London daily-message cron composes on the paid key itself.
  fallback: async () => ({ ok: false, reason: 'deferred to the daily-message cron' }),
}

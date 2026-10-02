import { listJobs } from '@/lib/data/thinking-jobs'
import {
  DAILY_MESSAGE_KIND,
  alreadyDelivered,
  dailyMessageJobKey,
} from '@/lib/kairos/daily-message'
import { gatherDailyMessageInputs } from '@/lib/kairos/daily-message-inputs'
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
// per London date, with exactly the compose prompt the daily-message cron
// would send on the paid key. Planned from 04:00 UTC once the night's thinking
// that feeds it is settled (no live aether / idea / ask job left), or from
// 04:35 UTC regardless — so the 04:40Z brain-routine run drafts it in BST
// (delivery 05:00Z); in GMT the 05:40Z run does. The deadline is 05:55 London
// (5 min before delivery). apply only guards the draft and returns it as
// `output.draft` (the queue merges it into the completed job's output) — the
// 06:00 London cron delivers it, appending the numbered open-questions block
// at send time. Fallback = that cron (paid key, then deterministic); the
// sweep only marks the job expired.

const DEADLINE_LEAD_MS = 5 * 60_000
export const DAILY_MESSAGE_OPENS_UTC = { hour: 4, minute: 0 }
// Past this, plan on whatever exists even if a feeding job is still open.
export const NIGHT_SETTLED_UTC = { hour: 4, minute: 35 }
// Jobs whose output the message reads; a live one delays planning.
const FEEDING_KINDS = new Set(['aether', 'idea_generate', 'idea_judge', 'ask_mine'])
const OPEN = new Set(['queued', 'claimed'])

export function dailyMessageDeadline(now: Date): Date {
  return new Date(londonInstant(londonDate(now)).getTime() - DEADLINE_LEAD_MS)
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesUntil(now, dailyMessageDeadline(now))
  if (deadlineMinutes <= 0) return []
  const date = londonDate(now)
  // In summer time London's date turns over at 23:00 UTC: never plan
  // tomorrow's message before tomorrow's UTC night has even started.
  if (now.toISOString().slice(0, 10) !== date) return []
  if (now.getTime() < deadlineOn(now, DAILY_MESSAGE_OPENS_UTC).getTime()) return []

  const key = dailyMessageJobKey(date)
  const jobs = await listJobs(userId, { kind: DAILY_MESSAGE_KIND, since: new Date(now.getTime() - 2 * 86_400_000), limit: 10 })
  if (jobs.some((j) => j.externalKey === key)) return []
  if (await alreadyDelivered(userId, date)) return []
  // The prompt is frozen at planning: wait for tonight's feeding jobs (a job
  // past its deadline counts as settled — its cron covers it).
  if (now.getTime() < deadlineOn(now, NIGHT_SETTLED_UTC).getTime()) {
    const tonight = await listJobs(userId, { since: utcDayStart(now), limit: 200 })
    const live = tonight.some((j) => FEEDING_KINDS.has(j.kind) && OPEN.has(j.status) && j.deadlineAt.getTime() > now.getTime())
    if (live) return []
  }

  const inputs = await gatherDailyMessageInputs(userId, now)
  // Nothing about the areas or the self-model (none yet, or both reads
  // failed): leave it to the cron, whose deterministic text covers that case.
  if (!inputs.areas?.length && !inputs.aether?.length) return []
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
  // The 06:00 London daily-message cron composes on the paid key itself.
  fallback: async () => ({ ok: false, reason: 'deferred to the daily-message cron' }),
}

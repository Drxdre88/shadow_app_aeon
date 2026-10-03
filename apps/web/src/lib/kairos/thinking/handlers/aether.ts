import { countCortexRowsSince, listJobs } from '@/lib/data/thinking-jobs'
import { alreadyRanToday, fetchAetherInputs, persistAether } from '@/lib/kairos/aether'
import {
  AETHER_SYSTEM_PROMPT,
  aetherFedMemoryIds,
  aetherGenSchema,
  buildAetherUserPrompt,
  extractJsonBlock,
  groundAetherPayload,
} from '@/lib/kairos/aether-prompt'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import {
  AETHER_DEADLINE_UTC,
  CORTEX_DEADLINE_UTC,
  deadlineOn,
  minutesUntil,
  utcDay,
  utcDayStart,
} from '../deadlines'
import { errorReason } from './_errors'
import { aetherThoughts, withThoughts } from '../stage-thoughts'

// Aether on the thinking queue: one job per user per UTC day, with exactly
// the system/user prompt the 03:15 aether-regen cron would send. Planned
// lazily only once tonight's cortex work is settled (no live open cortex jobs
// — overdue ones count as settled — and today's cortex rows exist / a cortex
// job finished / the cortex deadline passed), so the routine drains cortex
// first and aether reads fresh cortices.
// Fallback = the 03:15 cron itself; the sweep only marks the job expired.

export const aetherJobKey = (day: string) => `aether:${day}`

const OPEN = new Set(['queued', 'claimed'])

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesUntil(now, deadlineOn(now, AETHER_DEADLINE_UTC))
  if (deadlineMinutes <= 0) return []

  const day = utcDay(now)
  const dayStart = utcDayStart(now)
  const jobs = await listJobs(userId, { since: dayStart, limit: 200 })
  if (jobs.some((j) => j.externalKey === aetherJobKey(day))) return []

  const cortexJobs = jobs.filter((j) => j.kind === 'cortex' && j.externalKey.endsWith(`:${day}`))
  // An open cortex job past its deadline is dead weight the hourly sweep has
  // not expired yet (its cron owns it) — it must not block aether.
  if (cortexJobs.some((j) => OPEN.has(j.status) && j.deadlineAt.getTime() > now.getTime())) return []
  const cortexSettled =
    cortexJobs.length > 0 ||
    now.getTime() >= deadlineOn(now, CORTEX_DEADLINE_UTC).getTime() ||
    (await countCortexRowsSince(userId, dayStart)) > 0
  if (!cortexSettled) return []

  if (await alreadyRanToday(userId)) return []

  const inputs = await fetchAetherInputs(userId)
  const hasSignal = inputs.cortexSnapshots.length > 0 || inputs.topReflections.length > 0 || inputs.archetypes.length > 0
  if (!hasSignal) return []

  return [{
    kind: 'aether',
    dominionId: null,
    externalKey: aetherJobKey(day),
    deadlineMinutes,
    input: {
      system: AETHER_SYSTEM_PROMPT,
      prompt: buildAetherUserPrompt({ userId, today: day, ...inputs }),
      validMemoryIds: [...aetherFedMemoryIds(inputs)],
      maxOutputTokens: 10000,
      context: { date: day },
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const date = typeof job.input?.context?.date === 'string' ? job.input.context.date : null
  if (!date) return { ok: false, reason: 'bad_job: aether job has no date context' }
  if (date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${date}` }
  if (await alreadyRanToday(job.userId)) return { ok: false, reason: 'already_ran: a live aether already exists today' }

  let payload: AetherPayload
  try {
    payload = groundAetherPayload(
      aetherGenSchema.parse(extractJsonBlock(text)),
      new Set(job.input.validMemoryIds ?? []),
    )
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  if (payload.thoughts.length === 0) {
    return { ok: false, reason: 'all_thoughts_ungrounded: every sourceMemoryIds entry must be one of validMemoryIds' }
  }

  const runId = `aether:routine:${job.userId}:${date}`
  const { aetherMemoryId } = await persistAether(job.userId, payload, runId, date, 'cron', {
    thinkingJobId: job.id,
    answeredBy,
  })
  if (!aetherMemoryId) return { ok: false, reason: 'persist_failed: insert returned no id' }
  return withThoughts({ ok: true, memoryIds: [aetherMemoryId] }, aetherThoughts(payload))
}

export const aetherHandler: ThinkingJobHandler = {
  kind: 'aether',
  plan,
  apply,
  // The 03:15 aether-regen cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 03:15 UTC aether-regen cron' }),
}

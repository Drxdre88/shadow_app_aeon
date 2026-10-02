import { z } from 'zod'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { alreadyRanToday as aetherRanToday } from '@/lib/kairos/aether'
import { askMineGate, askMineJobKey, finishAskMine, prepareAskMine } from '@/lib/kairos/ask-mine'
import { parseAskMineResponseStrict, type AskMineCandidate } from '@/lib/kairos/ask-mine-prompt'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { ASK_MINE_WINDOW_UTC, deadlineOn, minutesLeftInWindow, utcDay } from '../deadlines'
import { errorReason } from './_errors'

// Kairos's question to the operator on the thinking queue: one job per user
// per UTC date, planned once tonight's Aether is settled, with exactly the
// system/user prompt the 04:30 ask-mine cron would send. apply re-runs the
// cron's cheap gates, parses strictly and persists through finishAskMine —
// the cron's own write path — so the cron's isJobDone guard skips the user.
// A night with no signals plans nothing: the cron's deterministic card-notes
// nudge covers it without a model call. Fallback = the 04:30 cron itself.

export const ASK_MINE_CRON = 'ask-mine'
export const ASK_MINE_AETHER_CUTOFF_UTC = { hour: 3, minute: 30 }

const contextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validDominionIds: z.array(z.string()),
  aetherMemoryId: z.string().nullable(),
})
type AskMineJobContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): AskMineJobContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, ASK_MINE_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []

  const date = utcDay(now)
  const externalKey = askMineJobKey(date)
  if (await hasJobWithKeyLike(userId, 'ask_mine', externalKey)) return []
  // Tonight's Aether feeds the question bundle. Its job closes at 03:13 and the
  // 03:15 aether-regen fallback can still be running, so wait for today's
  // Aether until 03:30Z, then plan on whatever exists (as idea_generate does).
  if (now.getTime() < deadlineOn(now, ASK_MINE_AETHER_CUTOFF_UTC).getTime() && !(await aetherRanToday(userId))) return []

  const prepared = await prepareAskMine(userId, now, { date })
  if (prepared.status !== 'ready' || prepared.validSourceIds.size === 0) return []

  return [{
    kind: 'ask_mine',
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: prepared.modelInput.system,
      prompt: prepared.modelInput.prompt,
      validMemoryIds: [...prepared.validSourceIds],
      maxOutputTokens: prepared.modelInput.maxOutputTokens,
      context: {
        date,
        validDominionIds: [...prepared.validDominionIds],
        aetherMemoryId: prepared.bundle.aether.memoryId,
      } satisfies AskMineJobContext,
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: ask_mine job has no date/dominion context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }

  const now = new Date()
  const gate = await askMineGate(job.userId, c.date, now)
  if (gate.skip === 'already_ran') {
    return { ok: false, reason: 'already_ran: an ask was already mined today' }
  }
  if (gate.skip) {
    // A full open-ask backlog or an outstanding reply since planning: the cron
    // would skip the user too, so the night is complete without an ask.
    await writeCronSuccessTrace(job.userId, { cronName: ASK_MINE_CRON, outcome: 'skipped', skipReason: gate.skip })
    return { ok: true, memoryIds: [], output: { skipped: gate.skip, answeredBy } }
  }

  let candidates: AskMineCandidate[]
  try {
    candidates = parseAskMineResponseStrict(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  const result = await finishAskMine(job.userId, {
    date: c.date,
    now,
    candidates,
    validSourceIds: new Set(job.input.validMemoryIds ?? []),
    validDominionIds: new Set(c.validDominionIds),
    aetherMemoryId: c.aetherMemoryId,
  })
  await writeCronSuccessTrace(job.userId, {
    cronName: ASK_MINE_CRON,
    outcome: result.status === 'created' ? 'ok' : 'skipped',
    ...(result.status === 'skipped' ? { skipReason: result.reason } : {}),
  })
  if (result.status === 'created') return { ok: true, memoryIds: [result.askId], output: { answeredBy } }
  return { ok: true, memoryIds: [], output: { skipped: result.reason, answeredBy } }
}

export const askMineHandler: ThinkingJobHandler = {
  kind: 'ask_mine',
  plan,
  apply,
  // The 04:30 ask-mine cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 04:30 UTC ask-mine cron' }),
}

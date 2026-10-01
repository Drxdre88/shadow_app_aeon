import { findDominionsByUser } from '@/lib/data/dominions'
import { listJobs } from '@/lib/data/thinking-jobs'
import {
  alreadyRanToday,
  gatherIntrospectionContext,
  introspectionJobKey,
  isRawIntrospectionEnabled,
  persistIntrospectionProposals,
} from '@/lib/kairos/introspection'
import {
  INTROSPECTION_SYSTEM_PROMPT,
  buildIntrospectionUserPrompt,
  extractJsonBlock,
  filterGroundedProposals,
  introspectionOutSchema,
  type Proposal,
} from '@/lib/kairos/introspection-prompt'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { INTROSPECTION_WINDOW_UTC, minutesLeftInWindow, utcDay, utcDayStart } from '../deadlines'
import { errorReason } from './_errors'

// Guided introspection (the raw idea dump) on the thinking queue: one job per
// active Dominion per UTC day, with exactly the system/user prompt the 06:30
// introspection cron would send. The answer is parsed strictly (no repair
// round-trip), grounded against the fed memory ids and staged through the
// cron's own persistIntrospectionProposals — so the cron's alreadyRanToday
// (or its done-job guard, when nothing survived grounding) skips that
// Dominion. Off with the cron when KAIROS_RAW_INTROSPECTION retires it.
// Fallback = the 06:30 cron itself; the sweep only marks the job expired.

interface IntrospectionJobContext {
  dominionId: string
  date: string
}

function readContext(job: ThinkingJobRow): IntrospectionJobContext | null {
  const c = job.input?.context as Partial<IntrospectionJobContext> | undefined
  if (!c || typeof c.dominionId !== 'string' || typeof c.date !== 'string') return null
  return { dominionId: c.dominionId, date: c.date }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, INTROSPECTION_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  if (!isRawIntrospectionEnabled()) return []

  const day = utcDay(now)
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt)
  if (active.length === 0) return []
  const existing = new Set(
    (await listJobs(userId, { kind: 'introspection', since: utcDayStart(now), limit: 200 })).map((j) => j.externalKey),
  )

  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = introspectionJobKey(dom.id, day)
    if (existing.has(externalKey)) continue
    // Same gates as runIntrospectionForDominion.
    if (await alreadyRanToday(userId, dom.id)) continue
    const ctx = await gatherIntrospectionContext(userId, dom.id)
    if (!ctx || ctx.recentMemories.length === 0) continue

    specs.push({
      kind: 'introspection',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: INTROSPECTION_SYSTEM_PROMPT,
        prompt: buildIntrospectionUserPrompt(ctx, day),
        validMemoryIds: ctx.recentMemories.map((m) => m.id),
        maxOutputTokens: 8000,
        context: { dominionId: dom.id, date: day } satisfies IntrospectionJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: introspection job has no dominion/date context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }
  if (await alreadyRanToday(job.userId, c.dominionId)) {
    return { ok: false, reason: 'already_ran: introspection proposals for this Dominion already exist today' }
  }

  const validIds = job.input.validMemoryIds ?? []
  let proposals: Proposal[]
  try {
    proposals = filterGroundedProposals(introspectionOutSchema.parse(extractJsonBlock(text)), new Set(validIds))
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  // Zero grounded proposals still closes the night (the cron writes the same
  // all_thoughts_ungrounded trace and stops) — it is not retried on the paid key.
  const runId = `introspection:${c.dominionId}:${c.date}`
  const memoryIds = await persistIntrospectionProposals(job.userId, c.dominionId, proposals, validIds, runId, {
    thinkingJobId: job.id,
    answeredBy,
  })
  return { ok: true, memoryIds }
}

export const introspectionHandler: ThinkingJobHandler = {
  kind: 'introspection',
  plan,
  apply,
  // The 06:30 introspection cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 06:30 UTC introspection cron' }),
}

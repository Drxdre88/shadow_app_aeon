import { findDominionsByUser } from '@/lib/data/dominions'
import { listJobs } from '@/lib/data/thinking-jobs'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import {
  gatherMicroConsolidateContext,
  hourBucket,
  microConsolidateJobKey,
  persistMicroConsolidateDelta,
} from '@/lib/kairos/micro-consolidate'
import {
  MICRO_CONSOLIDATE_SYSTEM_PROMPT,
  buildMicroConsolidateUserPrompt,
} from '@/lib/kairos/micro-consolidate-prompt'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { MICRO_CONSOLIDATE_LEAD_MINUTES, currentMicroSlot, minutesUntil } from '../deadlines'

// Micro-consolidate on the thinking queue: in the hour before each cron slot,
// one job per active Dominion with enough new substrate, carrying exactly the
// prompt the cron would send over the window ending at planning time. The
// answer is the plain-text delta body, persisted through the cron's own
// persistMicroConsolidateDelta under the SLOT's hour bucket — so the cron's
// isJobDone guard skips that Dominion at :15. Fallback = the cron itself.

interface MicroConsolidateJobContext {
  dominionId: string
  dominionName: string
  bucket: string
  since: string
  until: string
  newMemoryCount: number
  newMemoryTotal: number
  tasksCompleted: number
  tasksCreated: number
}

function readContext(job: ThinkingJobRow): MicroConsolidateJobContext | null {
  const c = job.input?.context as Partial<MicroConsolidateJobContext> | undefined
  if (
    !c
    || typeof c.dominionId !== 'string'
    || typeof c.dominionName !== 'string'
    || typeof c.bucket !== 'string'
    || typeof c.since !== 'string'
    || typeof c.until !== 'string'
  ) return null
  return {
    dominionId: c.dominionId,
    dominionName: c.dominionName,
    bucket: c.bucket,
    since: c.since,
    until: c.until,
    newMemoryCount: c.newMemoryCount ?? 0,
    newMemoryTotal: c.newMemoryTotal ?? c.newMemoryCount ?? 0,
    tasksCompleted: c.tasksCompleted ?? 0,
    tasksCreated: c.tasksCreated ?? 0,
  }
}

// The routine is told to send bare markdown; tolerate one wrapping fence.
function deltaBody(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return (fenced ? fenced[1] : trimmed).trim()
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  // planDue runs on every claim: outside a slot window, no DB read at all.
  const s = currentMicroSlot(now)
  if (!s) return []

  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt)
  if (active.length === 0) return []
  const bucket = hourBucket(s.slot)
  const windowOpens = new Date(s.slot.getTime() - MICRO_CONSOLIDATE_LEAD_MINUTES * 60_000)
  const existing = new Set(
    (await listJobs(userId, { kind: 'micro_consolidate', since: windowOpens, limit: 200 })).map((j) => j.externalKey),
  )
  const deadlineMinutes = minutesUntil(now, s.deadline)

  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = microConsolidateJobKey(dom.id, bucket)
    if (existing.has(externalKey)) continue
    const gathered = await gatherMicroConsolidateContext(userId, dom.id, now)
    if (!gathered.ok) continue
    const { ctx, newMemoryTotal } = gathered

    specs.push({
      kind: 'micro_consolidate',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: MICRO_CONSOLIDATE_SYSTEM_PROMPT,
        prompt: buildMicroConsolidateUserPrompt(ctx),
        maxOutputTokens: 1500,
        context: {
          dominionId: dom.id,
          dominionName: ctx.dominionName,
          bucket,
          since: ctx.since.toISOString(),
          until: ctx.now.toISOString(),
          newMemoryCount: ctx.newMemories.length,
          newMemoryTotal,
          tasksCompleted: ctx.tasksCompleted,
          tasksCreated: ctx.tasksCreated,
        } satisfies MicroConsolidateJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: micro_consolidate job has no dominion/window context' }
  const bodyMd = deltaBody(text)
  if (!bodyMd) return { ok: false, reason: 'parse_failed: empty delta' }

  const { memoryId } = await persistMicroConsolidateDelta(job.userId, {
    dominionId: c.dominionId,
    dominionName: c.dominionName,
    bucket: c.bucket,
    since: new Date(c.since),
    until: new Date(c.until),
    bodyMd,
    newMemoryCount: c.newMemoryCount,
    newMemoryTotal: c.newMemoryTotal,
    tasksCompleted: c.tasksCompleted,
    tasksCreated: c.tasksCreated,
    provenance: { answeredBy, thinkingJobId: job.id },
  })
  // Same liveness row the cron writes, so the health scorecard sees the slot.
  await writeCronSuccessTrace(job.userId, { cronName: 'micro-consolidate', dominionId: c.dominionId })
  return { ok: true, memoryIds: [memoryId] }
}

export const microConsolidateHandler: ThinkingJobHandler = {
  kind: 'micro_consolidate',
  plan,
  apply,
  // The next micro-consolidate cron slot is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the next micro-consolidate cron slot' }),
}

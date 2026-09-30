import { findDominionsByUser } from '@/lib/data/dominions'
import { listDominionsWithArchetypesSince, listJobs } from '@/lib/data/thinking-jobs'
import {
  alreadyRanToday,
  gatherCortexContext,
  persistCortex,
} from '@/lib/kairos/cortex'
import {
  CORTEX_SYSTEM_PROMPT,
  buildCortexUserPrompt,
  cortexGenSchema,
  extractJsonBlock,
  groundCortexOutput,
  type CortexContext,
  type CortexOutput,
} from '@/lib/kairos/cortex-prompt'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { CORTEX_DEADLINE_UTC, deadlineOn, minutesUntil, utcDay, utcDayStart } from '../deadlines'
import { errorReason } from './_errors'

// Cortex on the thinking queue: one job per active Dominion per UTC day, with
// exactly the system/user prompt the 03:00 cortex-regen cron would send. The
// routine's answer is parsed strictly (no repair round-trip), grounded against
// the archetype ids that were fed, and persisted through the cron's own
// persistCortex — so the cron's alreadyRanToday guard skips that Dominion.
// Fallback = the 03:00 cron itself; the sweep only marks the job expired.

export const cortexJobKey = (dominionId: string, day: string) => `cortex:${dominionId}:${day}`

interface CortexJobContext {
  dominionId: string
  dominionName: string
  date: string
  reflectionTrail: Array<{ id: string; title: string; createdAt: string }>
}

function readContext(job: ThinkingJobRow): CortexJobContext | null {
  const c = job.input?.context as Partial<CortexJobContext> | undefined
  if (!c || typeof c.dominionId !== 'string' || typeof c.date !== 'string' || typeof c.dominionName !== 'string') return null
  return {
    dominionId: c.dominionId,
    dominionName: c.dominionName,
    date: c.date,
    reflectionTrail: Array.isArray(c.reflectionTrail) ? c.reflectionTrail : [],
  }
}

// persistCortex renders markdown from ctx.name + the reflection trail only;
// rebuild just those from the job so the stored body matches the prompt.
function renderContext(c: CortexJobContext): CortexContext {
  return {
    dominionId: c.dominionId,
    name: c.dominionName,
    vision: null,
    missionLong: null,
    objectives: [],
    boardTasks: [],
    reflections: c.reflectionTrail.map((r) => ({ id: r.id, title: r.title, summary: null, createdAt: new Date(r.createdAt) })),
    archetypes: [],
    prior: null,
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesUntil(now, deadlineOn(now, CORTEX_DEADLINE_UTC))
  if (deadlineMinutes <= 0) return []

  const dayStart = utcDayStart(now)
  // Prerequisite: tonight's archetype synthesis has written something.
  const archetypeDoms = await listDominionsWithArchetypesSince(userId, dayStart)
  if (archetypeDoms.size === 0) return []

  const day = utcDay(now)
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt)
  if (active.length === 0) return []
  const existing = new Set(
    (await listJobs(userId, { kind: 'cortex', since: dayStart, limit: 200 })).map((j) => j.externalKey),
  )

  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = cortexJobKey(dom.id, day)
    if (existing.has(externalKey)) continue
    if (await alreadyRanToday(userId, dom.id)) continue

    const ctx = await gatherCortexContext(userId, dom.id)
    if (!ctx) continue
    // Same gates as runCortexRegenForDominion, plus: an active Dominion
    // waits until ITS archetypes for today exist (the 02:30 run can still be
    // mid-fleet), so the prompt never anchors on yesterday's archetypes.
    const hasActivitySignal = ctx.reflections.length > 0 || ctx.boardTasks.length > 0
    if (hasActivitySignal && (ctx.archetypes.length === 0 || !archetypeDoms.has(dom.id))) continue
    const hasSignal = ctx.archetypes.length + ctx.reflections.length > 0 || Boolean(ctx.vision) || Boolean(ctx.missionLong)
    if (!hasSignal) continue

    specs.push({
      kind: 'cortex',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: CORTEX_SYSTEM_PROMPT,
        prompt: buildCortexUserPrompt(ctx, day),
        validMemoryIds: ctx.archetypes.map((a) => a.id),
        maxOutputTokens: 8000,
        context: {
          dominionId: dom.id,
          dominionName: ctx.name,
          date: day,
          reflectionTrail: ctx.reflections.slice(0, 6).map((r) => ({
            id: r.id,
            title: r.title,
            createdAt: r.createdAt.toISOString(),
          })),
        } satisfies CortexJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: cortex job has no dominion/date context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }
  if (await alreadyRanToday(job.userId, c.dominionId)) {
    return { ok: false, reason: 'already_ran: a live cortex for this Dominion already exists today' }
  }

  let payload: CortexOutput
  try {
    payload = groundCortexOutput(cortexGenSchema.parse(extractJsonBlock(text)), job.input.validMemoryIds ?? [])
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  const runId = `cortex:routine:${c.dominionId}:${c.date}`
  const { cortexMemoryId } = await persistCortex(job.userId, renderContext(c), payload, runId, c.date, {
    thinkingJobId: job.id,
    answeredBy,
  })
  if (!cortexMemoryId) return { ok: false, reason: 'persist_failed: insert returned no id' }
  return { ok: true, memoryIds: [cortexMemoryId] }
}

export const cortexHandler: ThinkingJobHandler = {
  kind: 'cortex',
  plan,
  apply,
  // The 03:00 cortex-regen cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 03:00 UTC cortex-regen cron' }),
}

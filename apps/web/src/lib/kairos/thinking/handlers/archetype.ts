import { findDominionsByUser } from '@/lib/data/dominions'
import { skipForFocus } from '@/lib/data/dominion-focus'
import { hasLiveOpenJob, listJobs } from '@/lib/data/thinking-jobs'
import {
  alreadyRanToday,
  archetypeFedIds,
  archetypeJobKey,
  gatherArchetypeContext,
  hasArchetypeSignal,
  persistArchetypes,
} from '@/lib/kairos/archetypes'
import {
  ARCHETYPE_SYSTEM_PROMPT,
  archetypeOutSchema,
  buildArchetypeUserPrompt,
  extractJsonBlock,
  groundArchetypeCitations,
  type ArchetypeOutput,
} from '@/lib/kairos/archetypes-prompt'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { archetypeChangeCheck } from '@/lib/kairos/synthesis-change'
import type {
  ApplyOutcome,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { ARCHETYPE_WINDOW_UTC, minutesLeftInWindow, utcDay, utcDayStart } from '../deadlines'
import { errorReason } from './_errors'

// Archetype synthesis on the thinking queue: one job per active Dominion per
// UTC day, with exactly the system/user prompt the 02:30 archetype-synthesis
// cron would send. A Dominion with no new input since its last run is not
// planned (synthesis-change.ts; weekly refresh regardless). Planned only once
// tonight's chat distill has settled (its
// reflections are substrate). The answer is parsed strictly, grounded against
// the fed memory ids, and persisted through the cron's own persistArchetypes
// — so the rows are indistinguishable and the cron's alreadyRanToday guard
// (and the cortex handler's prerequisite) see them.
// Fallback = the 02:30 cron itself; the sweep only marks the job expired.

interface ArchetypeJobContext {
  dominionId: string
  date: string
}

function readContext(job: ThinkingJobRow): ArchetypeJobContext | null {
  const c = job.input?.context as Partial<ArchetypeJobContext> | undefined
  if (!c || typeof c.dominionId !== 'string' || typeof c.date !== 'string') return null
  return { dominionId: c.dominionId, date: c.date }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, ARCHETYPE_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  if (await hasLiveOpenJob(userId, 'chat_distill', now)) return []

  const day = utcDay(now)
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt && !skipForFocus(d))
  if (active.length === 0) return []
  const existing = new Set(
    (await listJobs(userId, { kind: 'archetype', since: utcDayStart(now), limit: 200 })).map((j) => j.externalKey),
  )

  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = archetypeJobKey(dom.id, day)
    if (existing.has(externalKey)) continue
    // Same gates as runArchetypeSynthesisForDominion.
    if (await alreadyRanToday(userId, dom.id)) continue
    if (!(await archetypeChangeCheck(userId, dom.id, now)).run) continue
    const ctx = await gatherArchetypeContext(userId, dom.id)
    if (!ctx || !hasArchetypeSignal(ctx)) continue

    specs.push({
      kind: 'archetype',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: ARCHETYPE_SYSTEM_PROMPT,
        prompt: buildArchetypeUserPrompt(ctx, day),
        validMemoryIds: archetypeFedIds(ctx),
        maxOutputTokens: 8000,
        context: { dominionId: dom.id, date: day } satisfies ArchetypeJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: archetype job has no dominion/date context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }
  if (await alreadyRanToday(job.userId, c.dominionId)) {
    return { ok: false, reason: 'already_ran: live archetypes for this Dominion already exist today' }
  }

  let payload: ArchetypeOutput
  try {
    payload = groundArchetypeCitations(archetypeOutSchema.parse(extractJsonBlock(text)), job.input.validMemoryIds ?? [])
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  const runId = `archetype:${c.dominionId}:${c.date}`
  const { archetypeMemoryIds } = await persistArchetypes(job.userId, c.dominionId, payload, runId)
  if (archetypeMemoryIds.length === 0) return { ok: false, reason: 'persist_failed: no archetypes written' }
  await writeCronSuccessTrace(job.userId, { cronName: 'archetype-synthesis', dominionId: c.dominionId })
  return { ok: true, memoryIds: archetypeMemoryIds }
}

export const archetypeHandler: ThinkingJobHandler = {
  kind: 'archetype',
  plan,
  apply,
  // The 02:30 archetype-synthesis cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 02:30 UTC archetype-synthesis cron' }),
}

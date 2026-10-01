import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser } from '@/lib/data/dominions'
import { captureMemory, validAsOfNow } from '@/lib/data/memories'
import { countTasksCompletedBetween, countTasksCreatedBetween } from '@/lib/data/board-signals'
import { isJobDone } from '@/lib/data/thinking-jobs'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import {
  MICRO_CONSOLIDATE_SYSTEM_PROMPT,
  buildMicroConsolidateUserPrompt,
  type MicroConsolidateContext,
  type MicroConsolidateNewMemory,
} from './micro-consolidate-prompt'
import { todayIso } from './_prompt-utils'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Micro-consolidation (intraday delta folding).
//
// Runs several times a day, off-peak of the nightly synthesis chain (schedule
// lives in vercel.json). Per active Dominion: if enough new substrate
// has landed since the last fold, write ONE compact streamClass='delta'
// memory — "what changed since the last cortex reading" — that the nightly
// cortex/aether generators read back as their "Today so far" grounding
// section (see cortex-prompt.ts / aether-prompt.ts).
//
// Window anchor: GREATEST(end of the last live delta's window — its stored
// `until`, else its createdAt — and today's live cortex's createdAt); with
// neither, now − FIRST_RUN_LOOKBACK_MS. There is deliberately NO UTC-midnight
// floor — it used to drop everything between the last evening run and 00:00
// from every delta.
//
// On Claude Max the same fold is a 'micro_consolidate' thinking job
// (thinking/handlers/micro-consolidate.ts) planned before each slot; the cron
// skips a Dominion whose slot job is already done.
//
// Threshold: skip Dominions with fewer than MIN_NEW_MEMORIES new rows since
// the anchor (mirrors the hasSignal guard in archetypes.ts/cortex.ts) — a
// quiet interval costs nothing.
//
// Type choice (documented divergence): type='observation', NOT type='snapshot'.
// project-snapshot.ts's runEphemeralLifecycleForUser reclassifies EVERY
// type='snapshot' row's streamClass back to 'snapshot' and TTL-archives it
// after SNAPSHOT_TTL_DAYS — both would silently break the streamClass='delta'
// contract this feature depends on. 'observation' carries no such lifecycle
// hook and is already a first-class memoryTypeSchema value.
// ─────────────────────────────────────────────────────────────────────────

const MIN_NEW_MEMORIES = 3
const MAX_NEW_MEMORY_ROWS = 30
// Lookback when neither a prior delta nor today's cortex anchors the window
// (first-ever run / cortex hasn't fired). Longest gap between scheduled runs is
// the overnight one (~7h), so 18h covers it with room while stopping a
// brand-new Dominion from folding its whole history into one delta.
const FIRST_RUN_LOOKBACK_MS = 18 * 60 * 60 * 1000

export function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13) // "2026-07-24T15"
}

// Thinking-queue key of the routine fold for one Dominion and slot hour —
// the cron skips a slot whose job is already done.
export const microConsolidateJobKey = (dominionId: string, bucket: string) =>
  `micro_consolidate:${dominionId}:${bucket}`

function dayStartUtc(): Date {
  return new Date(`${todayIso()}T00:00:00.000Z`)
}

// End of the window the last live delta summarised: its stored `until`, or
// its createdAt for rows written before `until` was stored. A routine fold
// lands minutes after its window closed, so anchoring on createdAt would drop
// whatever arrived in between from every future window.
async function lastDeltaWindowEnd(userId: string, dominionId: string): Promise<Date | null> {
  const [row] = await db
    .select({
      createdAt: memories.createdAt,
      until: sql<string | null>`${memories.sourceMetadata}->>'until'`,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'delta'),
      isNull(memories.archivedAt),
      validAsOfNow,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const until = row.until ? new Date(row.until) : null
  return until && !Number.isNaN(until.getTime()) ? until : row.createdAt
}

async function todaysCortexCreatedAt(userId: string, dominionId: string, dayStart: Date): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: memories.createdAt })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
      gte(memories.createdAt, dayStart),
      validAsOfNow,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

async function computeWindowStart(userId: string, dominionId: string, now: Date = new Date()): Promise<Date> {
  const lastDelta = await lastDeltaWindowEnd(userId, dominionId)
  const cortexToday = await todaysCortexCreatedAt(userId, dominionId, dayStartUtc())

  // No UTC-midnight floor: activity after the last evening run must roll into
  // the next run's delta instead of falling into a gap at 00:00.
  let since: Date | null = null
  if (lastDelta) since = lastDelta
  if (cortexToday && (!since || cortexToday > since)) since = cortexToday
  return since ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS)
}

// Excludes 'trace' (cron bookkeeping) and 'delta' (this generator's own prior
// folds) — neither is substrate a delta should re-summarise. The window is
// [since, until), so the next window (anchored on this one's `until`) neither
// repeats nor drops a row.
//
// Runs the LIMIT-30 fetch alongside a COUNT(*) over the same predicate so a
// window with more than MAX_NEW_MEMORY_ROWS new memories is visible as a
// truncation rather than silently summarising only the newest 30 — the
// caller stamps sourceMetadata.truncated when total exceeds rows.length.
async function fetchNewMemoriesSince(
  userId: string,
  dominionId: string,
  since: Date,
  until: Date,
): Promise<{ rows: MicroConsolidateNewMemory[]; total: number }> {
  const scope = and(
    eq(memories.userId, userId),
    eq(memories.dominionId, dominionId),
    isNull(memories.archivedAt),
    sql`${memories.streamClass} NOT IN ('trace', 'delta')`,
    gte(memories.createdAt, since),
    lt(memories.createdAt, until),
    validAsOfNow,
  )

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ title: memories.title, type: memories.type, streamClass: memories.streamClass })
      .from(memories)
      .where(scope)
      .orderBy(desc(memories.createdAt))
      .limit(MAX_NEW_MEMORY_ROWS),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(memories)
      .where(scope),
  ])

  return { rows, total }
}

export interface MicroConsolidateRunResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped' | 'error'
  newMemoryCount?: number
  deltaMemoryId?: string
  reason?: string
}

export type MicroConsolidateGather =
  | { ok: true; ctx: MicroConsolidateContext; newMemoryTotal: number }
  | { ok: false; result: MicroConsolidateRunResult }

// Window [since, now), substrate and board counts for one Dominion's fold —
// shared by the cron and the thinking-queue planner, so both apply the same
// threshold and send the same prompt over the same window.
export async function gatherMicroConsolidateContext(
  userId: string,
  dominionId: string,
  now: Date = new Date(),
): Promise<MicroConsolidateGather> {
  const [dom] = await db
    .select({ id: dominions.id, name: dominions.name, archivedAt: dominions.archivedAt })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  if (!dom) return { ok: false, result: { dominionId, dominionName: '(unknown)', status: 'error', reason: 'dominion not found' } }
  if (dom.archivedAt) return { ok: false, result: { dominionId, dominionName: dom.name, status: 'skipped', reason: 'archived' } }

  const since = await computeWindowStart(userId, dominionId, now)
  const { rows: newMemories, total: newMemoryTotal } = await fetchNewMemoriesSince(userId, dominionId, since, now)

  if (newMemories.length < MIN_NEW_MEMORIES) {
    return {
      ok: false,
      result: {
        dominionId,
        dominionName: dom.name,
        status: 'skipped',
        reason: 'below threshold',
        newMemoryCount: newMemories.length,
      },
    }
  }

  // Board counts scoped to THIS Dominion's own projects — not the user-wide
  // (incl. shared-project) totals every Dominion's delta used to repeat.
  const [tasksCompleted, tasksCreated] = await Promise.all([
    countTasksCompletedBetween(userId, since, now, { dominionId }),
    countTasksCreatedBetween(userId, since, now, { dominionId }),
  ])

  return {
    ok: true,
    ctx: { dominionId, dominionName: dom.name, since, now, newMemories, tasksCompleted, tasksCreated },
    newMemoryTotal,
  }
}

export interface MicroConsolidateDelta {
  dominionId: string
  dominionName: string
  bucket: string
  since: Date
  until: Date
  bodyMd: string
  newMemoryCount: number
  newMemoryTotal: number
  tasksCompleted: number
  tasksCreated: number
  // Set when the routine answered the fold on the thinking queue.
  provenance?: { answeredBy: string; thinkingJobId: string }
}

// One delta memory per Dominion per hour bucket, cron and routine alike. Both
// keep source 'cron': captureMemory dedups on (source, externalId), so a
// routine fold and a cron run for the same slot converge on one row.
export async function persistMicroConsolidateDelta(
  userId: string,
  delta: MicroConsolidateDelta,
): Promise<{ memoryId: string; created: boolean }> {
  const truncated = delta.newMemoryTotal > delta.newMemoryCount
  const { memory, created } = await captureMemory(userId, {
    title: `${delta.dominionName} · delta ${delta.bucket}`,
    bodyMd: delta.bodyMd,
    type: 'observation',
    streamClass: 'delta',
    source: 'cron',
    dominionId: delta.dominionId,
    sourceMetadata: {
      externalId: `micro-consolidate:${delta.dominionId}:${delta.bucket}`,
      kind: 'micro_consolidate',
      since: delta.since.toISOString(),
      // The next window starts here (lastDeltaWindowEnd).
      until: delta.until.toISOString(),
      newMemoryCount: delta.newMemoryCount,
      tasksCompleted: delta.tasksCompleted,
      tasksCreated: delta.tasksCreated,
      // Visibility for a window with more substrate than the LIMIT-30 fetch
      // summarised — otherwise this is a silent truncation.
      ...(truncated ? { truncated: true, newMemoryTotal: delta.newMemoryTotal } : {}),
      ...(delta.provenance ?? {}),
    },
  })
  return { memoryId: memory.id, created }
}

export async function runMicroConsolidateForDominion(
  userId: string,
  dominionId: string,
): Promise<MicroConsolidateRunResult> {
  const now = new Date()
  const gathered = await gatherMicroConsolidateContext(userId, dominionId, now)
  if (!gathered.ok) return gathered.result
  const { ctx, newMemoryTotal } = gathered
  const { dominionName } = ctx
  const bucket = hourBucket(now)

  // The routine already folded this slot on Max.
  if (await isJobDone(userId, microConsolidateJobKey(dominionId, bucket))) {
    return { dominionId, dominionName, status: 'existing', reason: 'answered on Max' }
  }

  let text: string
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'delta', dominionId })
    const response = await provider.ask({
      system: MICRO_CONSOLIDATE_SYSTEM_PROMPT,
      prompt: buildMicroConsolidateUserPrompt(ctx),
      cacheSystem: true,
      maxTokens: 1500,
    })
    text = response.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) {
      return { dominionId, dominionName, status: 'skipped', reason: 'no BYOK credential' }
    }
    if (err instanceof AiCredentialDecryptError) {
      return { dominionId, dominionName, status: 'skipped', reason: 'key undecryptable' }
    }
    await writeCronFailureTrace(userId, { cronName: 'micro-consolidate', dominionId, reason: 'provider_call_failed', error: err })
    return { dominionId, dominionName, status: 'error', reason: err instanceof Error ? err.message : String(err) }
  }

  if (!text) {
    await writeCronFailureTrace(userId, { cronName: 'micro-consolidate', dominionId, reason: 'empty_response' })
    return { dominionId, dominionName, status: 'error', reason: 'empty model response' }
  }

  const { memoryId, created } = await persistMicroConsolidateDelta(userId, {
    dominionId,
    dominionName,
    bucket,
    since: ctx.since,
    until: now,
    bodyMd: text,
    newMemoryCount: ctx.newMemories.length,
    newMemoryTotal,
    tasksCompleted: ctx.tasksCompleted,
    tasksCreated: ctx.tasksCreated,
  })

  return {
    dominionId,
    dominionName,
    status: created ? 'created' : 'existing',
    newMemoryCount: ctx.newMemories.length,
    deltaMemoryId: memoryId,
  }
}

export async function runMicroConsolidateForUser(userId: string): Promise<MicroConsolidateRunResult[]> {
  const all = await findDominionsByUser(userId)
  const active = all.filter((d) => !d.archivedAt)
  const results: MicroConsolidateRunResult[] = []
  for (const dom of active) {
    try {
      const result = await runMicroConsolidateForDominion(userId, dom.id)
      results.push(result)
      // Liveness for the health scorecard; 'error' already wrote a failure trace.
      if (result.status !== 'error') {
        await writeCronSuccessTrace(userId, {
          cronName: 'micro-consolidate',
          dominionId: dom.id,
          ...(result.status === 'skipped' ? { outcome: 'skipped' as const, skipReason: result.reason } : {}),
        })
      }
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'micro-consolidate',
        dominionId: dom.id,
        reason: 'uncaught_exception',
        error: err,
      })
      results.push({
        dominionId: dom.id,
        dominionName: dom.name,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

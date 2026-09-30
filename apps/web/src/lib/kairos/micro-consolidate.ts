import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser } from '@/lib/data/dominions'
import { captureMemory, validAsOfNow } from '@/lib/data/memories'
import { countTasksCompletedBetween, countTasksCreatedBetween } from '@/lib/data/board-signals'
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
// Window anchor: GREATEST(last live delta's createdAt, today's live cortex's
// createdAt); with neither, now − FIRST_RUN_LOOKBACK_MS. There is deliberately
// NO UTC-midnight floor — it used to drop everything between the last evening
// run and 00:00 from every delta.
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

function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13) // "2026-07-24T15"
}

function dayStartUtc(): Date {
  return new Date(`${todayIso()}T00:00:00.000Z`)
}

async function lastDeltaCreatedAt(userId: string, dominionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: memories.createdAt })
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
  return row?.createdAt ?? null
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
  const lastDelta = await lastDeltaCreatedAt(userId, dominionId)
  const cortexToday = await todaysCortexCreatedAt(userId, dominionId, dayStartUtc())

  // No UTC-midnight floor: activity after the last evening run must roll into
  // the next run's delta instead of falling into a gap at 00:00.
  let since: Date | null = null
  if (lastDelta) since = lastDelta
  if (cortexToday && (!since || cortexToday > since)) since = cortexToday
  return since ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS)
}

// Excludes 'trace' (cron bookkeeping) and 'delta' (this generator's own prior
// folds) — neither is substrate a delta should re-summarise.
//
// Runs the LIMIT-30 fetch alongside a COUNT(*) over the same predicate so a
// window with more than MAX_NEW_MEMORY_ROWS new memories is visible as a
// truncation rather than silently summarising only the newest 30 — the
// caller stamps sourceMetadata.truncated when total exceeds rows.length.
async function fetchNewMemoriesSince(
  userId: string,
  dominionId: string,
  since: Date,
): Promise<{ rows: MicroConsolidateNewMemory[]; total: number }> {
  const scope = and(
    eq(memories.userId, userId),
    eq(memories.dominionId, dominionId),
    isNull(memories.archivedAt),
    sql`${memories.streamClass} NOT IN ('trace', 'delta')`,
    gte(memories.createdAt, since),
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

export async function runMicroConsolidateForDominion(
  userId: string,
  dominionId: string,
): Promise<MicroConsolidateRunResult> {
  const [dom] = await db
    .select({ id: dominions.id, name: dominions.name, archivedAt: dominions.archivedAt })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  if (!dom) return { dominionId, dominionName: '(unknown)', status: 'error', reason: 'dominion not found' }
  if (dom.archivedAt) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'archived' }

  const since = await computeWindowStart(userId, dominionId)
  const { rows: newMemories, total: newMemoryTotal } = await fetchNewMemoriesSince(userId, dominionId, since)

  if (newMemories.length < MIN_NEW_MEMORIES) {
    return {
      dominionId,
      dominionName: dom.name,
      status: 'skipped',
      reason: 'below threshold',
      newMemoryCount: newMemories.length,
    }
  }

  const now = new Date()
  // Board counts scoped to THIS Dominion's own projects — not the user-wide
  // (incl. shared-project) totals every Dominion's delta used to repeat.
  const [tasksCompleted, tasksCreated] = await Promise.all([
    countTasksCompletedBetween(userId, since, now, { dominionId }),
    countTasksCreatedBetween(userId, since, now, { dominionId }),
  ])

  const ctx: MicroConsolidateContext = {
    dominionId,
    dominionName: dom.name,
    since,
    now,
    newMemories,
    tasksCompleted,
    tasksCreated,
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
      return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' }
    }
    if (err instanceof AiCredentialDecryptError) {
      return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'key undecryptable' }
    }
    await writeCronFailureTrace(userId, { cronName: 'micro-consolidate', dominionId, reason: 'provider_call_failed', error: err })
    return { dominionId, dominionName: dom.name, status: 'error', reason: err instanceof Error ? err.message : String(err) }
  }

  if (!text) {
    await writeCronFailureTrace(userId, { cronName: 'micro-consolidate', dominionId, reason: 'empty_response' })
    return { dominionId, dominionName: dom.name, status: 'error', reason: 'empty model response' }
  }

  const bucket = hourBucket(now)
  const truncated = newMemoryTotal > newMemories.length
  const { memory, created } = await captureMemory(userId, {
    title: `${dom.name} · delta ${bucket}`,
    bodyMd: text,
    type: 'observation',
    streamClass: 'delta',
    source: 'cron',
    dominionId,
    sourceMetadata: {
      externalId: `micro-consolidate:${dominionId}:${bucket}`,
      kind: 'micro_consolidate',
      since: since.toISOString(),
      newMemoryCount: newMemories.length,
      tasksCompleted,
      tasksCreated,
      // Visibility for a window with more substrate than the LIMIT-30 fetch
      // summarised — otherwise this is a silent truncation.
      ...(truncated ? { truncated: true, newMemoryTotal } : {}),
    },
  })

  return {
    dominionId,
    dominionName: dom.name,
    status: created ? 'created' : 'existing',
    newMemoryCount: newMemories.length,
    deltaMemoryId: memory.id,
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

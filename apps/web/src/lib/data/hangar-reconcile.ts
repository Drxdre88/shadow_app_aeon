import { db } from '@/lib/db'
import { agentSessions, boardTasks } from '@/lib/db/schema'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getNextEventSeq, recordSessionEventWithAutoSeq, resolveResultColumn } from './sessions'
import { touchProject } from './projects'
import { canEditProject } from './hangar-access'

// Stall reconciler (hangar.md §6 gap). Runs from /api/cron/hangar-reconcile.
// A running mission whose runner stopped reporting is settled as 'timeout'
// and its card moved to Tower; a queued mission nobody claimed stays queued
// (the runner may come back) but is flagged "runner offline" once.

export const DEFAULT_STALE_MINUTES = 30
const BATCH_LIMIT = 100

export function staleThresholdMinutes(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.KAIROS_HANGAR_STALE_MIN)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALE_MINUTES
}

export interface StaleSessionRow {
  id: string
  taskId: string | null
  userId?: string
}

export interface ReconcileReport {
  thresholdMinutes: number
  timedOut: string[]
  flaggedOffline: string[]
  failed: Array<{ sessionId: string; error: string }>
}

const lastSignal = sql`coalesce(${agentSessions.lastHeartbeatAt}, ${agentSessions.claimedAt}, ${agentSessions.startedAt}, ${agentSessions.spawnedAt})`

const cutoffSql = (cutoff: Date) => sql`${cutoff.toISOString()}::timestamp`

// Quiet means no heartbeat AND no telemetry since the cutoff: a runner that
// streams events but lost its heartbeat timer is still working.
const quietSince = (cutoff: Date) => and(
  sql`${lastSignal} < ${cutoffSql(cutoff)}`,
  sql`not exists (select 1 from session_events e where e.session_id = ${agentSessions.id} and e.created_at >= ${cutoffSql(cutoff)})`,
)

export async function findStaleRunningSessions(cutoff: Date): Promise<StaleSessionRow[]> {
  return db
    .select({ id: agentSessions.id, taskId: agentSessions.taskId, userId: agentSessions.userId })
    .from(agentSessions)
    .where(and(eq(agentSessions.status, 'running'), isNotNull(agentSessions.taskId), quietSince(cutoff)))
    .limit(BATCH_LIMIT)
}

export async function findUnclaimedQueuedSessions(cutoff: Date): Promise<StaleSessionRow[]> {
  return db
    .select({ id: agentSessions.id, taskId: agentSessions.taskId, userId: agentSessions.userId })
    .from(agentSessions)
    .where(and(
      eq(agentSessions.status, 'queued'),
      isNotNull(agentSessions.taskId),
      lt(agentSessions.spawnedAt, cutoff),
      isNull(sql`${agentSessions.metadata} -> 'reconcile'`),
    ))
    .limit(BATCH_LIMIT)
}

// The card is only touched when the session's owner can still edit its project
// (same rule as recordSessionResult); otherwise only the session row settles.
async function findCard(taskId: string | null, userId?: string) {
  if (!taskId) return null
  const [task] = await db
    .select({ id: boardTasks.id, projectId: boardTasks.projectId })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))
    .limit(1)
  if (!task) return null
  if (userId && !(await canEditProject(task.projectId, userId))) return null
  return task
}

export function timeoutReason(minutes: number): string {
  return `The runner stopped reporting for more than ${minutes} minutes, so this mission was marked as timed out. Use Requeue to run it again.`
}

/** Settle one stuck running mission as 'timeout'; null when it recovered or settled meanwhile. */
export async function timeOutStaleSession(row: StaleSessionRow, cutoff: Date, minutes: number, now = new Date()) {
  const card = await findCard(row.taskId, row.userId)
  const columnId = card ? await resolveResultColumn(card.projectId, 'needs_input') : null
  const reason = timeoutReason(minutes)
  const at = now.toISOString()
  const reconcile = { reconcile: { kind: 'timeout', reason, at } }
  const lastResult = { status: 'failed', outcome: 'blocked', summary: reason }
  const stall = { kind: 'timeout', sessionId: row.id, at, minutes }

  const settled = await db.transaction(async (tx) => {
    // Re-checked inside the UPDATE: a heartbeat or result landing between the
    // scan and this write wins, and the mission is left alone.
    const [session] = await tx
      .update(agentSessions)
      .set({
        status: 'timeout',
        endedAt: now,
        updatedAt: now,
        metadata: sql`coalesce(${agentSessions.metadata}, '{}'::jsonb) || ${JSON.stringify(reconcile)}::jsonb`,
      })
      .where(and(eq(agentSessions.id, row.id), eq(agentSessions.status, 'running'), quietSince(cutoff)))
      .returning({ id: agentSessions.id })
    if (!session) return false
    if (card) {
      await tx
        .update(boardTasks)
        .set({
          metadata: sql`jsonb_set(jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar,lastResult}', ${JSON.stringify(lastResult)}::jsonb, true), '{hangar,stall}', ${JSON.stringify(stall)}::jsonb, true)`,
          ...(columnId ? { columnId } : {}),
          updatedAt: now,
        })
        .where(eq(boardTasks.id, card.id))
    }
    return true
  })
  if (!settled) return null

  if (card) await touchProject(card.projectId, { type: 'task:updated' })
  try {
    const seq = await getNextEventSeq(row.id)
    await recordSessionEventWithAutoSeq(row.id, { seq, kind: 'system', payload: { subtype: 'timeout', message: reason } })
  } catch (err) {
    console.error('[hangar-reconcile] timeout trace failed', { sessionId: row.id, error: err instanceof Error ? err.message : String(err) })
  }
  return { sessionId: row.id, taskId: card?.id ?? null }
}

/** Flag a long-unclaimed queued mission (and its card) as waiting on an offline runner. */
export async function flagRunnerOffline(row: StaleSessionRow, minutes: number, now = new Date()) {
  const card = await findCard(row.taskId, row.userId)
  const at = now.toISOString()
  const reason = `No runner has picked this mission up for more than ${minutes} minutes. The runner may be offline.`
  const reconcile = { reconcile: { kind: 'runner_offline', reason, at } }
  const stall = { kind: 'runner_offline', sessionId: row.id, at, minutes }

  const flagged = await db.transaction(async (tx) => {
    const [session] = await tx
      .update(agentSessions)
      .set({ metadata: sql`coalesce(${agentSessions.metadata}, '{}'::jsonb) || ${JSON.stringify(reconcile)}::jsonb`, updatedAt: now })
      .where(and(eq(agentSessions.id, row.id), eq(agentSessions.status, 'queued')))
      .returning({ id: agentSessions.id })
    if (!session) return false
    if (card) {
      await tx
        .update(boardTasks)
        .set({ metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar,stall}', ${JSON.stringify(stall)}::jsonb, true)`, updatedAt: now })
        .where(eq(boardTasks.id, card.id))
    }
    return true
  })
  if (!flagged) return null
  if (card) await touchProject(card.projectId, { type: 'task:updated' })
  return { sessionId: row.id, taskId: card?.id ?? null }
}

export async function reconcileHangarSessions(opts: { minutes?: number; now?: Date } = {}): Promise<ReconcileReport> {
  const minutes = opts.minutes ?? staleThresholdMinutes()
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - minutes * 60_000)
  const report: ReconcileReport = { thresholdMinutes: minutes, timedOut: [], flaggedOffline: [], failed: [] }

  const settle = async (rows: StaleSessionRow[], apply: (row: StaleSessionRow) => Promise<unknown>, into: string[]) => {
    for (const row of rows) {
      try {
        if (await apply(row)) into.push(row.id)
      } catch (err) {
        report.failed.push({ sessionId: row.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  await settle(await findStaleRunningSessions(cutoff), (row) => timeOutStaleSession(row, cutoff, minutes, now), report.timedOut)
  await settle(await findUnclaimedQueuedSessions(cutoff), (row) => flagRunnerOffline(row, minutes, now), report.flaggedOffline)
  return report
}

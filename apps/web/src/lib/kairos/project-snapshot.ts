import { db } from '@/lib/db'
import { projects, boardTasks, activityEvents, memories } from '@/lib/db/schema'
import { and, eq, isNull, gte, lt, desc, sql } from 'drizzle-orm'
import { captureMemory } from '@/lib/data/memories'
import { SNAPSHOT_TTL_DAYS, ADVISORY_TTL_DAYS, cutoffDate } from './lifecycle'
import { writeCronFailureTrace } from './cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (A5) — nightly project snapshot.
//
// Per non-archived project per user, generates one memory.type='snapshot'
// summarising today's activity: open tasks count, completed today,
// blocked, and the last 5 events. The Briefer reads these the next
// morning as "what changed yesterday."
//
// Idempotent on (date × projectId) via externalId.
// ─────────────────────────────────────────────────────────────────────────

function todayBoundsUtc(): { start: Date; end: Date; iso: string } {
  const now = new Date()
  const iso = now.toISOString().slice(0, 10)
  const start = new Date(`${iso}T00:00:00.000Z`)
  const end = new Date(`${iso}T23:59:59.999Z`)
  return { start, end, iso }
}

export interface ProjectSnapshotResult {
  projectId: string
  projectName: string
  status: 'created' | 'existing' | 'skipped'
  reason?: string
}

async function snapshotProject(
  userId: string,
  project: { id: string; name: string; dominionId: string | null },
  bounds: ReturnType<typeof todayBoundsUtc>,
): Promise<ProjectSnapshotResult> {
  // Counts: open (not done, not archived), completed today, blocked.
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`sum(case when ${boardTasks.status} <> 'done' then 1 else 0 end)::int`,
      doneToday: sql<number>`sum(case when ${boardTasks.status} = 'done' and ${boardTasks.completedAt} >= ${bounds.start} and ${boardTasks.completedAt} <= ${bounds.end} then 1 else 0 end)::int`,
      blocked: sql<number>`sum(case when ${boardTasks.status} = 'blocked' then 1 else 0 end)::int`,
    })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, project.id),
      isNull(boardTasks.archivedAt),
    ))

  const recent = await db
    .select({
      action: activityEvents.action,
      entityName: activityEvents.entityName,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.projectId, project.id),
      gte(activityEvents.createdAt, bounds.start),
    ))
    .orderBy(desc(activityEvents.createdAt))
    .limit(5)

  // Skip projects with literally zero activity AND zero open tasks today —
  // saves a memory row per dormant project.
  const openCount = counts?.open ?? 0
  const doneToday = counts?.doneToday ?? 0
  if (recent.length === 0 && openCount === 0 && doneToday === 0) {
    return { projectId: project.id, projectName: project.name, status: 'skipped', reason: 'dormant' }
  }

  const lines: string[] = [
    `**${project.name}** — daily snapshot ${bounds.iso}`,
    '',
    `- Open: ${openCount}`,
    `- Completed today: ${doneToday}`,
    `- Blocked: ${counts?.blocked ?? 0}`,
  ]
  if (recent.length > 0) {
    lines.push('', '**Recent activity:**')
    for (const e of recent) {
      const name = e.entityName ?? '(untitled)'
      lines.push(`- ${e.action} · ${name}`)
    }
  }

  const { memory, created } = await captureMemory(userId, {
    title: `${bounds.iso} · ${project.name} snapshot`,
    bodyMd: lines.join('\n'),
    type: 'snapshot',
    // Ephemeral status — NOT 'idea'. Keeps snapshots out of the briefer's
    // substrate so they never pollute the operator's real idea stream.
    streamClass: 'snapshot',
    source: 'cron',
    projectId: project.id,
    dominionId: project.dominionId,
    sourceMetadata: {
      externalId: `project_snapshot:${bounds.iso}:${project.id}`,
      snapshotDate: bounds.iso,
      kind: 'project_snapshot',
      counts: { open: openCount, doneToday, blocked: counts?.blocked ?? 0 },
    },
  })

  return {
    projectId: project.id,
    projectName: project.name,
    status: created ? 'created' : 'existing',
  }
}

export async function runProjectSnapshotsForUser(userId: string): Promise<ProjectSnapshotResult[]> {
  const userProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      dominionId: projects.dominionId,
    })
    .from(projects)
    .where(eq(projects.userId, userId))

  if (userProjects.length === 0) return []

  const bounds = todayBoundsUtc()
  const results: ProjectSnapshotResult[] = []
  for (const p of userProjects) {
    try {
      results.push(await snapshotProject(userId, p, bounds))
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'project-snapshot',
        dominionId: p.dominionId,
        reason: 'uncaught_exception',
        error: err,
      })
      results.push({
        projectId: p.id,
        projectName: p.name,
        status: 'skipped',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

export interface EphemeralLifecycleResult {
  reclassified: number
  snapshotsArchived: number
  advisoriesArchived: number
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot / advisory lifecycle — the "compost" pass. Runs nightly after the
// snapshot creation so ephemeral machine-memories don't balloon the brain:
//   1. Reclassify any stray snapshot off whatever stream it landed on (older
//      rows defaulted to 'idea', polluting the briefer's substrate) → 'snapshot'.
//   2. Archive snapshots past SNAPSHOT_TTL_DAYS and advisories past
//      ADVISORY_TTL_DAYS — stamped archivedAt, never deleted, so the trail
//      survives but retrieval/graph stop carrying the dead weight.
// User-scoped; multi-tenant safe.
// ─────────────────────────────────────────────────────────────────────────
export async function runEphemeralLifecycleForUser(userId: string): Promise<EphemeralLifecycleResult> {
  const now = new Date()

  const reclassed = await db
    .update(memories)
    .set({ streamClass: 'snapshot' })
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'snapshot'),
      sql`${memories.streamClass} <> 'snapshot'`,
      isNull(memories.archivedAt),
    ))
    .returning({ id: memories.id })

  const snapArchived = await db
    .update(memories)
    .set({ archivedAt: now })
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'snapshot'),
      isNull(memories.archivedAt),
      lt(memories.createdAt, cutoffDate(now, SNAPSHOT_TTL_DAYS)),
    ))
    .returning({ id: memories.id })

  const advArchived = await db
    .update(memories)
    .set({ archivedAt: now })
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      isNull(memories.archivedAt),
      lt(memories.createdAt, cutoffDate(now, ADVISORY_TTL_DAYS)),
    ))
    .returning({ id: memories.id })

  return {
    reclassified: reclassed.length,
    snapshotsArchived: snapArchived.length,
    advisoriesArchived: advArchived.length,
  }
}

export interface ReconcileDerivedMemoriesResult {
  invalidatedTaskFacts: number
  backfillArchived: number
}

// Safety-net TTL for the 'board-backfill' tag — bulk board-card imports that
// slip through without the write-path streamClass guard (createMemory in
// lib/data/memories.ts) still age out.
const BOARD_BACKFILL_TAG = 'board-backfill'
const BOARD_BACKFILL_TTL_DAYS = 30

// ─────────────────────────────────────────────────────────────────────────
// WP3 — derived-state invalidation tier. A memory.type='fact' anchored to a
// board task (taskId) is only true while the task it describes is still
// live: once the task is done, the fact is stale. Stamp invalidAt — never
// archive — so the belief trail survives but retrieval's validAsOfNow gate
// (lib/data/memories.ts, lib/kairos/retrieve.ts) drops it from every leg
// immediately. Also sweeps any 'board-backfill'-tagged memory past its TTL
// as a safety net for future bulk imports.
//
// Task DELETION is handled at delete time (deleteTask/deleteTasksByColumn in
// lib/data/tasks.ts), not here: memories.taskId is ON DELETE SET NULL, so by
// sweep time a deleted task's facts have a nulled anchor and are invisible
// to this query. This sweep only catches the done transition.
//
// Real incident 2026-07-20: 21 frozen card-facts from a 2026-05-31 board
// backfill poisoned Telegram chat (archived by hand at the time).
//
// Global pass, not user-scoped — a single table scan across all users is
// cheap and each row's task-liveness check is self-contained (the EXISTS
// subquery only ever matches the row's own project's task).
// ─────────────────────────────────────────────────────────────────────────
export async function reconcileDerivedMemories(now: Date = new Date()): Promise<ReconcileDerivedMemoriesResult> {
  const invalidated = await db
    .update(memories)
    .set({ invalidAt: now })
    .where(and(
      eq(memories.type, 'fact'),
      isNull(memories.archivedAt),
      eq(memories.pinned, false),
      isNull(memories.invalidAt),
      sql`${memories.taskId} IS NOT NULL`,
      sql`EXISTS (SELECT 1 FROM ${boardTasks} WHERE ${boardTasks.id} = ${memories.taskId} AND (${boardTasks.status} = 'done' OR ${boardTasks.archivedAt} IS NOT NULL))`,
    ))
    .returning({ id: memories.id })

  const backfillArchived = await db
    .update(memories)
    .set({ archivedAt: now })
    .where(and(
      isNull(memories.archivedAt),
      eq(memories.pinned, false),
      sql`${memories.tags} @> ${JSON.stringify([BOARD_BACKFILL_TAG])}::jsonb`,
      lt(memories.createdAt, cutoffDate(now, BOARD_BACKFILL_TTL_DAYS)),
    ))
    .returning({ id: memories.id })

  return {
    invalidatedTaskFacts: invalidated.length,
    backfillArchived: backfillArchived.length,
  }
}

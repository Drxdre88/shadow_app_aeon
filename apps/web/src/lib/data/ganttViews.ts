import { db } from '@/lib/db'
import { ganttViews, rows, ganttTasks, boardTasks } from '@/lib/db/schema'
import { eq, and, asc, isNull, isNotNull, inArray, or, sql } from 'drizzle-orm'
import type { CreateGanttViewInput, UpdateGanttViewInput } from './validators'
import { computeDuration, computeEndDate, skipToWeekday } from './bridge'
import { clearTimelineLinksForGanttTasks } from './gantt'
import { touchProject } from './projects'

export async function findGanttViews(projectId: string) {
  return db
    .select()
    .from(ganttViews)
    .where(eq(ganttViews.projectId, projectId))
    .orderBy(asc(ganttViews.createdAt))
}

export async function findGanttViewById(viewId: string, projectId: string) {
  const [view] = await db
    .select()
    .from(ganttViews)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))

  return view || null
}

export async function createGanttView(
  projectId: string,
  data: CreateGanttViewInput,
  clientId?: string
) {
  const [view] = await db
    .insert(ganttViews)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      name: data.name,
      groupBy: data.groupBy,
      filters: data.filters,
    })
    .returning()

  await touchProject(projectId, { type: 'task:updated' })
  return view
}

export async function updateGanttView(
  viewId: string,
  projectId: string,
  data: UpdateGanttViewInput
) {
  const updates: Partial<typeof ganttViews.$inferInsert> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.groupBy !== undefined) updates.groupBy = data.groupBy
  if (data.filters !== undefined) updates.filters = data.filters

  const [view] = await db
    .update(ganttViews)
    .set(updates)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))
    .returning()

  if (view) await touchProject(projectId, { type: 'task:updated' })
  return view || null
}

/**
 * Delete a view. `rows.ganttViewId` cascades, which would leave this view's
 * bars behind with a null rowId — invisible, but still holding `onTimeline`
 * and `ganttTaskId` on their cards. So the bars go with the view and the
 * cards' timeline links are cleared. Card dates are user data and stay.
 */
export async function deleteGanttView(viewId: string, projectId: string) {
  const deleted = await db.transaction(async (tx) => {
    const viewRows = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(and(eq(rows.projectId, projectId), eq(rows.ganttViewId, viewId)))

    const rowIds = viewRows.map((r) => r.id)
    if (rowIds.length > 0) {
      const viewGanttTasks = await tx
        .select({ id: ganttTasks.id })
        .from(ganttTasks)
        .where(and(eq(ganttTasks.projectId, projectId), inArray(ganttTasks.rowId, rowIds)))

      const ganttTaskIds = viewGanttTasks.map((g) => g.id)
      if (ganttTaskIds.length > 0) {
        await clearTimelineLinksForGanttTasks(tx, projectId, ganttTaskIds)
        await tx.delete(ganttTasks).where(inArray(ganttTasks.id, ganttTaskIds))
      }
    }

    const [row] = await tx
      .delete(ganttViews)
      .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))
      .returning({ id: ganttViews.id })

    return row
  })

  if (deleted) await touchProject(projectId, { type: 'task:updated' })
  return !!deleted
}

export async function reflowGanttViewRows(projectId: string, viewId: string) {
  const viewRows = await db
    .select({ id: rows.id })
    .from(rows)
    .where(and(eq(rows.projectId, projectId), eq(rows.ganttViewId, viewId)))

  const rowIds = viewRows.map((r) => r.id)
  if (rowIds.length === 0) return

  const viewGanttTasks = await db
    .select()
    .from(ganttTasks)
    .where(and(eq(ganttTasks.projectId, projectId), inArray(ganttTasks.rowId, rowIds)))

  const linkedBoardTaskIds = viewGanttTasks
    .filter((gt) => gt.boardTaskId)
    .map((gt) => gt.boardTaskId!)

  const doneBoardTasks = linkedBoardTaskIds.length > 0
    ? await db
        .select({ id: boardTasks.id })
        .from(boardTasks)
        .where(and(inArray(boardTasks.id, linkedBoardTaskIds), eq(boardTasks.status, 'done')))
    : []
  const doneIds = new Set(doneBoardTasks.map((t) => t.id))

  const activeTasks = viewGanttTasks.filter(
    (gt) => !(gt.boardTaskId && doneIds.has(gt.boardTaskId))
  )

  const boardTaskMap = new Map<string, { size: number | null; priority: string }>()
  if (linkedBoardTaskIds.length > 0) {
    const bt = await db
      .select({ id: boardTasks.id, size: boardTasks.size, priority: boardTasks.priority })
      .from(boardTasks)
      .where(inArray(boardTasks.id, linkedBoardTaskIds))
    for (const t of bt) {
      boardTaskMap.set(t.id, { size: t.size, priority: t.priority })
    }
  }

  const [view] = await db
    .select()
    .from(ganttViews)
    .where(eq(ganttViews.id, viewId))

  const filters = (view?.filters ?? {}) as Record<string, unknown>
  const skipWk = !(filters.allowWeekends as boolean)

  let today = new Date()
  today.setHours(0, 0, 0, 0)
  if (skipWk) today = skipToWeekday(today)

  const rowGroups = new Map<string, typeof activeTasks>()
  for (const task of activeTasks) {
    const group = rowGroups.get(task.rowId!) || []
    group.push(task)
    rowGroups.set(task.rowId!, group)
  }

  const ganttUpdates: { id: string; startDate: Date; endDate: Date }[] = []
  const boardUpdates: { id: string; startDate: Date; endDate: Date }[] = []

  for (const [, group] of rowGroups) {
    group.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())

    let cursor = new Date(today)
    for (const task of group) {
      const bt = task.boardTaskId ? boardTaskMap.get(task.boardTaskId) : null
      const duration = bt
        ? computeDuration(bt.size, bt.priority)
        : Math.max(1, Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / (24 * 60 * 60 * 1000)))
      if (skipWk) cursor = skipToWeekday(cursor)
      const newStart = new Date(cursor)
      const newEnd = computeEndDate(newStart, duration, skipWk)

      ganttUpdates.push({ id: task.id, startDate: newStart, endDate: newEnd })
      if (task.boardTaskId) {
        boardUpdates.push({ id: task.boardTaskId, startDate: newStart, endDate: newEnd })
      }
      cursor = newEnd
    }
  }

  if (ganttUpdates.length > 0) {
    await db.transaction(async (tx) => {
      for (const u of ganttUpdates) {
        await tx.update(ganttTasks)
          .set({ startDate: u.startDate, endDate: u.endDate, updatedAt: new Date() })
          .where(eq(ganttTasks.id, u.id))
      }
      for (const u of boardUpdates) {
        await tx.update(boardTasks)
          .set({ startDate: u.startDate, endDate: u.endDate, updatedAt: new Date() })
          .where(eq(boardTasks.id, u.id))
      }
    })
    await touchProject(projectId, { type: 'task:updated' })
  }
}

/**
 * Tear down the project's orphaned timeline state.
 *
 * The date wipe is SCOPED to cards that are actually on a timeline. A card that
 * was never pushed still carries whatever `startDate`/`endDate` a user typed by
 * hand on the board, and the unscoped wipe this replaces destroyed those dates
 * for the whole project.
 *
 * Either half of the link qualifies, because the two can drift: deleting a bar
 * nulls `ganttTaskId` via the FK while `onTimeline` stays true. The scope is
 * resolved BEFORE the orphan-bar delete, since that delete nulls `ganttTaskId`
 * on the way through.
 */
export interface TimelineResetSnapshotEntry {
  id: string
  startDate: string | null
  endDate: string | null
  onTimeline: boolean
}

export async function resetGanttProjectData(projectId: string): Promise<TimelineResetSnapshotEntry[]> {
  const snapshot = await db.transaction(async (tx) => {
    const scoped = await tx
      .select({
        id: boardTasks.id,
        startDate: boardTasks.startDate,
        endDate: boardTasks.endDate,
        onTimeline: boardTasks.onTimeline,
      })
      .from(boardTasks)
      .where(and(
        eq(boardTasks.projectId, projectId),
        or(eq(boardTasks.onTimeline, true), isNotNull(boardTasks.ganttTaskId))
      ))

    await tx.delete(rows).where(
      and(eq(rows.projectId, projectId), isNull(rows.ganttViewId))
    )

    const orphanGantt = await tx
      .select({ id: ganttTasks.id })
      .from(ganttTasks)
      .where(and(eq(ganttTasks.projectId, projectId), isNull(ganttTasks.rowId)))

    if (orphanGantt.length > 0) {
      await tx.delete(ganttTasks).where(
        inArray(ganttTasks.id, orphanGantt.map((g) => g.id))
      )
    }

    const ids = scoped.map((t) => t.id)
    if (ids.length > 0) {
      await tx
        .update(boardTasks)
        .set({ onTimeline: false, ganttTaskId: null, startDate: null, endDate: null, updatedAt: new Date() })
        .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, ids)))
    }

    return scoped.map((t) => ({
      id: t.id,
      startDate: t.startDate ? t.startDate.toISOString() : null,
      endDate: t.endDate ? t.endDate.toISOString() : null,
      onTimeline: t.onTimeline,
    }))
  })

  if (snapshot.length > 0) await touchProject(projectId, { type: 'task:updated' })
  return snapshot
}

export const RESTORE_CHUNK = 500

/**
 * Undo of resetGanttProjectData: puts the snapshot's dates and timeline flag
 * back on every card in one transaction — one UPDATE per chunk from a VALUES
 * list, one touchProject — instead of one round trip per card. Dates travel as
 * the snapshot's UTC ISO text with an explicit cast, because the columns are
 * naive timestamps and a Date parameter would be serialised in the server's
 * zone. Cards that no longer belong to the project are left alone, so the
 * count returned is the rows the database actually wrote, not the entries sent.
 */
export async function restoreTimelineSnapshot(projectId: string, entries: readonly TimelineResetSnapshotEntry[]): Promise<number> {
  if (entries.length === 0) return 0
  const updatedAt = new Date().toISOString()
  let restored = 0
  await db.transaction(async (tx) => {
    for (let i = 0; i < entries.length; i += RESTORE_CHUNK) {
      const chunk = entries.slice(i, i + RESTORE_CHUNK)
      const values = sql.join(
        chunk.map(
          (e) => sql`(${e.id}::uuid, ${e.onTimeline}::boolean, ${e.startDate}::timestamp, ${e.endDate}::timestamp)`,
        ),
        sql`, `,
      )
      const result = await tx.execute(sql`
        update board_tasks as t
        set on_timeline = v.on_timeline,
            start_date = v.start_date,
            end_date = v.end_date,
            updated_at = ${updatedAt}::timestamp
        from (values ${values}) as v(id, on_timeline, start_date, end_date)
        where t.id = v.id and t.project_id = ${projectId}
      `)
      restored += result.rowCount ?? 0
    }
  })
  await touchProject(projectId, { type: 'task:updated' })
  return restored
}

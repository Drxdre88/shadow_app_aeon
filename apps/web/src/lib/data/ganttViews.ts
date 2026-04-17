import { db } from '@/lib/db'
import { ganttViews, rows, ganttTasks, boardTasks } from '@/lib/db/schema'
import { eq, and, asc, isNull, inArray } from 'drizzle-orm'
import type { CreateGanttViewInput, UpdateGanttViewInput } from './validators'
import { computeDuration, computeEndDate, skipToWeekday } from './bridge'

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

  return view || null
}

export async function deleteGanttView(viewId: string, projectId: string) {
  const [deleted] = await db
    .delete(ganttViews)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))
    .returning({ id: ganttViews.id })

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
  }
}

export async function resetGanttProjectData(projectId: string) {
  await db.delete(rows).where(
    and(eq(rows.projectId, projectId), isNull(rows.ganttViewId))
  )

  const orphanGantt = await db
    .select({ id: ganttTasks.id })
    .from(ganttTasks)
    .where(and(eq(ganttTasks.projectId, projectId), isNull(ganttTasks.rowId)))

  if (orphanGantt.length > 0) {
    await db.delete(ganttTasks).where(
      inArray(ganttTasks.id, orphanGantt.map((g) => g.id))
    )
  }

  await db
    .update(boardTasks)
    .set({ onTimeline: false, ganttTaskId: null, startDate: null, endDate: null, updatedAt: new Date() })
    .where(eq(boardTasks.projectId, projectId))
}

import { db } from '@/lib/db'
import { ganttTasks, rows, boardTasks } from '@/lib/db/schema'
import { eq, and, asc, inArray, isNull, or, sql } from 'drizzle-orm'
import { touchProject } from './projects'
import type { CreateGanttTaskInput, UpdateGanttTaskInput } from './validators'

export async function findGanttTasksWithRows(projectId: string) {
  const [tasks, projectRows] = await Promise.all([
    db.select().from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
    db
      .select()
      .from(rows)
      .where(eq(rows.projectId, projectId))
      .orderBy(asc(rows.orderIndex)),
  ])

  return { tasks, rows: projectRows }
}

export async function findGanttTasks(projectId: string) {
  return db
    .select()
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId))
}

export async function verifyRowOwnership(rowId: string, projectId: string) {
  const [row] = await db
    .select({ id: rows.id })
    .from(rows)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))

  return !!row
}

/**
 * Verify a batch of rowIds all belong to the same project.
 * Returns true only if every rowId in the input is owned by projectId.
 * Used for batch_create_gantt_tasks + reorder_rows to reject partial ownership
 * in a single query rather than N verifyRowOwnership calls.
 */
export async function verifyRowsOwnership(rowIds: string[], projectId: string) {
  if (rowIds.length === 0) return true
  const unique = Array.from(new Set(rowIds))
  const found = await db
    .select({ id: rows.id })
    .from(rows)
    .where(and(inArray(rows.id, unique), eq(rows.projectId, projectId)))
  return found.length === unique.length
}

/**
 * Drop the card-side half of the board <-> timeline link for bars that are
 * about to be deleted.
 *
 * `boardTasks.ganttTaskId` is ON DELETE SET NULL, so the FK clears the pointer
 * on its own — but nothing clears `onTimeline`, which left cards flagged as
 * scheduled with no bar behind them (the board shows the timeline pip, the
 * "push to Gantt" action stays hidden, and the next reset wipes their dates).
 * Both halves are matched, since either can be the stale one after a drift.
 *
 * MUST be called BEFORE the bars are deleted — afterwards the FK has already
 * nulled `ganttTaskId` and the boardTaskId link is gone with the row.
 */
export async function clearTimelineLinksForGanttTasks(
  tx: Pick<typeof db, 'select' | 'update'>,
  projectId: string,
  ganttTaskIds: string[]
) {
  if (ganttTaskIds.length === 0) return

  const linked = await tx
    .select({ boardTaskId: ganttTasks.boardTaskId })
    .from(ganttTasks)
    .where(and(eq(ganttTasks.projectId, projectId), inArray(ganttTasks.id, ganttTaskIds)))

  const boardTaskIds = linked
    .map((l) => l.boardTaskId)
    .filter((id): id is string => !!id)

  const match = boardTaskIds.length > 0
    ? or(inArray(boardTasks.id, boardTaskIds), inArray(boardTasks.ganttTaskId, ganttTaskIds))
    : inArray(boardTasks.ganttTaskId, ganttTaskIds)

  await tx
    .update(boardTasks)
    .set({ onTimeline: false, ganttTaskId: null, updatedAt: new Date() })
    .where(and(eq(boardTasks.projectId, projectId), match))
}

/**
 * Set the card-side half of the link for freshly created bars. Only cards with
 * no bar yet are claimed, so a card already on a timeline keeps pointing at its
 * original bar instead of silently orphaning it.
 */
async function linkTimelineCards(
  tx: Pick<typeof db, 'update'>,
  projectId: string,
  links: { boardTaskId: string; ganttTaskId: string }[]
) {
  for (const { boardTaskId, ganttTaskId } of links) {
    await tx
      .update(boardTasks)
      .set({ ganttTaskId, onTimeline: true, updatedAt: new Date() })
      .where(and(
        eq(boardTasks.id, boardTaskId),
        eq(boardTasks.projectId, projectId),
        isNull(boardTasks.ganttTaskId)
      ))
  }
}

export async function createGanttTask(
  projectId: string,
  data: CreateGanttTaskInput,
  clientId?: string
) {
  const task = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(ganttTasks)
      .values({
        ...(clientId ? { id: clientId } : {}),
        projectId,
        rowId: data.rowId,
        boardTaskId: data.boardTaskId || null,
        name: data.name,
        description: data.description || null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        color: data.color,
        progress: data.progress,
      })
      .returning()

    if (created?.boardTaskId) {
      await linkTimelineCards(tx, projectId, [
        { boardTaskId: created.boardTaskId, ganttTaskId: created.id },
      ])
    }

    return created
  })

  await touchProject(projectId, { type: 'task:updated' })
  return task
}

export async function updateGanttTask(
  taskId: string,
  projectId: string,
  data: UpdateGanttTaskInput
) {
  const updates: Partial<typeof ganttTasks.$inferInsert> = { updatedAt: new Date() }
  if (data.rowId !== undefined) updates.rowId = data.rowId
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.color !== undefined) updates.color = data.color
  if (data.progress !== undefined) updates.progress = data.progress
  if (data.boardTaskId !== undefined) updates.boardTaskId = data.boardTaskId ?? null

  const [task] = await db
    .update(ganttTasks)
    .set(updates)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
    .returning()

  if (task) await touchProject(projectId, { type: 'task:updated' })
  return task || null
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  const deleted = await db.transaction(async (tx) => {
    await clearTimelineLinksForGanttTasks(tx, projectId, [taskId])

    const [row] = await tx
      .delete(ganttTasks)
      .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
      .returning({ id: ganttTasks.id })

    return row
  })

  if (deleted) await touchProject(projectId, { type: 'task:updated' })
  return !!deleted
}

export async function findRows(projectId: string) {
  return db
    .select()
    .from(rows)
    .where(eq(rows.projectId, projectId))
    .orderBy(asc(rows.orderIndex))
}

export async function createRow(
  projectId: string,
  data: { name: string; color: string; orderIndex?: number },
  clientId?: string
) {
  if (data.orderIndex !== undefined) {
    const [row] = await db
      .insert(rows)
      .values({
        ...(clientId ? { id: clientId } : {}),
        projectId,
        name: data.name,
        color: data.color,
        orderIndex: data.orderIndex,
      })
      .returning()
    await touchProject(projectId, { type: 'task:updated' })
    return row
  }

  const [row] = await db.transaction(async (tx) => {
    const [result] = await tx
      .select({ max: sql<number>`coalesce(max(${rows.orderIndex}), -1)` })
      .from(rows)
      .where(eq(rows.projectId, projectId))

    return tx
      .insert(rows)
      .values({
        ...(clientId ? { id: clientId } : {}),
        projectId,
        name: data.name,
        color: data.color,
        orderIndex: result.max + 1,
      })
      .returning()
  })

  await touchProject(projectId, { type: 'task:updated' })
  return row
}

export async function updateRow(
  rowId: string,
  projectId: string,
  data: { name?: string; color?: string; orderIndex?: number }
) {
  const updates: Partial<typeof rows.$inferInsert> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.color !== undefined) updates.color = data.color
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex

  const [row] = await db
    .update(rows)
    .set(updates)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
    .returning()

  if (row) await touchProject(projectId, { type: 'task:updated' })
  return row || null
}

/**
 * Delete a lane. `ganttTasks.rowId` is ON DELETE SET NULL, so the lane's bars
 * would survive as invisible orphans still holding their cards' timeline
 * flags. They go with the lane, and their cards are unflagged.
 */
export async function deleteRow(rowId: string, projectId: string) {
  const deleted = await db.transaction(async (tx) => {
    const rowGanttTasks = await tx
      .select({ id: ganttTasks.id })
      .from(ganttTasks)
      .where(and(eq(ganttTasks.projectId, projectId), eq(ganttTasks.rowId, rowId)))

    const ganttTaskIds = rowGanttTasks.map((g) => g.id)
    if (ganttTaskIds.length > 0) {
      await clearTimelineLinksForGanttTasks(tx, projectId, ganttTaskIds)
      await tx.delete(ganttTasks).where(inArray(ganttTasks.id, ganttTaskIds))
    }

    const [row] = await tx
      .delete(rows)
      .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
      .returning({ id: rows.id })

    return row
  })

  if (deleted) await touchProject(projectId, { type: 'task:updated' })
  return !!deleted
}

/**
 * Batch-insert gantt tasks. All input tasks must target rowIds that belong
 * to `projectId` — the caller is responsible for enforcing that via
 * `verifyRowsOwnership`. All-or-nothing: single insert, no partial writes.
 */
export async function createGanttTasksBatch(
  projectId: string,
  tasks: CreateGanttTaskInput[]
) {
  if (tasks.length === 0) return []

  const values = tasks.map((t) => ({
    projectId,
    rowId: t.rowId,
    boardTaskId: t.boardTaskId || null,
    name: t.name,
    description: t.description || null,
    startDate: new Date(t.startDate),
    endDate: new Date(t.endDate),
    color: t.color,
    progress: t.progress,
  }))

  const created = await db.transaction(async (tx) => {
    const inserted = await tx.insert(ganttTasks).values(values).returning()

    const links = inserted
      .filter((gt) => gt.boardTaskId)
      .map((gt) => ({ boardTaskId: gt.boardTaskId!, ganttTaskId: gt.id }))

    await linkTimelineCards(tx, projectId, links)

    return inserted
  })

  await touchProject(projectId, { type: 'task:updated' })
  return created
}

/**
 * Reorder rows within a project. Mirrors `reorderColumns` — runs updates in
 * a single transaction, WHERE-scoped to projectId so foreign rowIds are no-ops.
 * Caller should pre-validate via `verifyRowsOwnership` when strict errors matter.
 */
export async function reorderRows(
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  if (updates.length === 0) return
  await db.transaction(async (tx) => {
    for (const { id, orderIndex } of updates) {
      await tx
        .update(rows)
        .set({ orderIndex })
        .where(and(eq(rows.id, id), eq(rows.projectId, projectId)))
    }
  })
  await touchProject(projectId, { type: 'task:updated' })
}

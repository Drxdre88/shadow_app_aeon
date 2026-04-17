import { db } from '@/lib/db'
import { ganttTasks, rows } from '@/lib/db/schema'
import { eq, and, asc, inArray, sql } from 'drizzle-orm'
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

export async function createGanttTask(
  projectId: string,
  data: CreateGanttTaskInput,
  clientId?: string
) {
  const [task] = await db
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

  return task || null
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  const [deleted] = await db
    .delete(ganttTasks)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
    .returning({ id: ganttTasks.id })

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

  return row || null
}

export async function deleteRow(rowId: string, projectId: string) {
  const [deleted] = await db
    .delete(rows)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
    .returning({ id: rows.id })

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

  return db.insert(ganttTasks).values(values).returning()
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
}

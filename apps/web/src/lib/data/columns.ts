import { db } from '@/lib/db'
import { boardColumns } from '@/lib/db/schema'
import { eq, and, asc, sql } from 'drizzle-orm'
import { touchProject } from './projects'

const BOARD_TEMPLATES: Record<string, { name: string; color: string; icon: string | null; orderIndex: number }[]> = {
  default: [
    { name: 'Todo', color: 'pink', icon: 'list-todo', orderIndex: 0 },
    { name: 'Doing', color: 'blue', icon: 'activity', orderIndex: 1 },
    { name: 'Review', color: 'purple', icon: 'eye', orderIndex: 2 },
    { name: 'Done', color: 'green', icon: 'check-circle', orderIndex: 3 },
  ],
  devBoard: [
    { name: 'Raw Ideas', color: '#fcd34d', icon: null, orderIndex: 0 },
    { name: 'Queue', color: '#fda4af', icon: 'list-todo', orderIndex: 1 },
    { name: 'Analysis', color: 'orange', icon: null, orderIndex: 2 },
    { name: 'Blocked', color: '#67e8f9', icon: null, orderIndex: 3 },
    { name: 'In Dev', color: '#fda4af', icon: null, orderIndex: 4 },
    { name: 'AI Review', color: '#8b5cf6', icon: null, orderIndex: 5 },
    { name: 'Human Review', color: '#a5b4fc', icon: null, orderIndex: 6 },
    { name: 'Done', color: 'green', icon: 'check-circle', orderIndex: 7 },
  ],
}

const DEFAULT_COLUMNS = BOARD_TEMPLATES.default

export async function findColumns(projectId: string) {
  return db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex))
}

export async function findColumnById(columnId: string, projectId: string) {
  const [col] = await db
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))

  return col || null
}

export async function createColumn(
  projectId: string,
  data: { name: string; color?: string; icon?: string; orderIndex?: number },
  clientId?: string
) {
  if (data.orderIndex !== undefined) {
    const [col] = await db
      .insert(boardColumns)
      .values({
        ...(clientId ? { id: clientId } : {}),
        projectId,
        name: data.name,
        color: data.color || 'purple',
        icon: data.icon || null,
        orderIndex: data.orderIndex,
      })
      .returning()
    await touchProject(projectId, { type: 'column:created' })
    return col
  }

  const [col] = await db.transaction(async (tx) => {
    const [result] = await tx
      .select({ max: sql<number>`coalesce(max(${boardColumns.orderIndex}), -1)` })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))

    return tx
      .insert(boardColumns)
      .values({
        ...(clientId ? { id: clientId } : {}),
        projectId,
        name: data.name,
        color: data.color || 'purple',
        icon: data.icon || null,
        orderIndex: result.max + 1,
      })
      .returning()
  })

  await touchProject(projectId, { type: 'column:created' })
  return col
}

export async function updateColumn(
  columnId: string,
  projectId: string,
  data: { name?: string; color?: string; icon?: string | null; orderIndex?: number }
) {
  const updates: Partial<typeof boardColumns.$inferInsert> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.color !== undefined) updates.color = data.color
  if (data.icon !== undefined) updates.icon = data.icon
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex

  const [col] = await db
    .update(boardColumns)
    .set(updates)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .returning()

  await touchProject(projectId, { type: 'column:updated' })
  return col || null
}

export async function deleteColumn(columnId: string, projectId: string) {
  const [deleted] = await db
    .delete(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .returning({ id: boardColumns.id })

  await touchProject(projectId, { type: 'column:deleted' })
  return !!deleted
}

export async function reorderColumns(
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  await db.transaction(async (tx) => {
    for (const { id, orderIndex } of updates) {
      await tx
        .update(boardColumns)
        .set({ orderIndex })
        .where(and(eq(boardColumns.id, id), eq(boardColumns.projectId, projectId)))
    }
  })
  await touchProject(projectId, { type: 'column:reordered' })
}

export async function createDefaultColumns(projectId: string, template?: string) {
  const existing = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .limit(1)

  if (existing.length > 0) return

  const columns = (template && BOARD_TEMPLATES[template]) || DEFAULT_COLUMNS

  await db.insert(boardColumns).values(
    columns.map((col) => ({
      projectId,
      name: col.name,
      color: col.color,
      icon: col.icon,
      orderIndex: col.orderIndex,
    }))
  )
}

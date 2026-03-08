import { db } from '@/lib/db'
import { boardColumns } from '@/lib/db/schema'
import { eq, and, asc, sql } from 'drizzle-orm'

const DEFAULT_COLUMNS = [
  { name: 'Todo', color: 'pink', icon: 'list-todo', orderIndex: 0 },
  { name: 'Doing', color: 'blue', icon: 'activity', orderIndex: 1 },
  { name: 'Review', color: 'purple', icon: 'eye', orderIndex: 2 },
  { name: 'Done', color: 'green', icon: 'check-circle', orderIndex: 3 },
]

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

  return col || null
}

export async function deleteColumn(columnId: string, projectId: string) {
  const [deleted] = await db
    .delete(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .returning({ id: boardColumns.id })

  return !!deleted
}

export async function reorderColumns(
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  await Promise.all(
    updates.map(({ id, orderIndex }) =>
      db
        .update(boardColumns)
        .set({ orderIndex })
        .where(and(eq(boardColumns.id, id), eq(boardColumns.projectId, projectId)))
    )
  )
}

export async function createDefaultColumns(projectId: string) {
  const existing = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .limit(1)

  if (existing.length > 0) return

  await db.insert(boardColumns).values(
    DEFAULT_COLUMNS.map((col) => ({
      projectId,
      name: col.name,
      color: col.color,
      icon: col.icon,
      orderIndex: col.orderIndex,
    }))
  )
}

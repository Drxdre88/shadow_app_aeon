import { db } from '@/lib/db'
import { taskVault, boardTasks, labels, taskLabels, checklistItems, boardColumns } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'

export async function findVaultTasks(projectId: string, limit = 200, offset = 0) {
  return db
    .select()
    .from(taskVault)
    .where(eq(taskVault.projectId, projectId))
    .orderBy(sql`coalesce(${taskVault.completedAt}, ${taskVault.archivedAt}) desc`)
    .limit(limit)
    .offset(offset)
}

export async function getVaultStats(projectId: string) {
  const [result] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgDays: sql<number>`avg(${taskVault.daysTaken})`,
      lowCount: sql<number>`count(*) filter (where ${taskVault.priority} = 'low')::int`,
      mediumCount: sql<number>`count(*) filter (where ${taskVault.priority} = 'medium')::int`,
      highCount: sql<number>`count(*) filter (where ${taskVault.priority} = 'high')::int`,
      urgentCount: sql<number>`count(*) filter (where ${taskVault.priority} = 'urgent')::int`,
      thisWeek: sql<number>`count(*) filter (where coalesce(${taskVault.completedAt}, ${taskVault.archivedAt}) > now() - interval '7 days')::int`,
    })
    .from(taskVault)
    .where(eq(taskVault.projectId, projectId))

  return {
    total: result?.total ?? 0,
    avgDays: result?.avgDays ? Math.round(result.avgDays * 10) / 10 : null,
    byPriority: {
      low: result?.lowCount ?? 0,
      medium: result?.mediumCount ?? 0,
      high: result?.highCount ?? 0,
      urgent: result?.urgentCount ?? 0,
    },
    thisWeek: result?.thisWeek ?? 0,
  }
}

async function snapshotTaskData(taskId: string, projectId: string) {
  const taskLabelRows = await db
    .select({ name: labels.name, color: labels.color })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(eq(taskLabels.taskId, taskId))

  const checklistRows = await db
    .select({ state: checklistItems.state })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  const checked = checklistRows.filter(r => r.state === 'checked').length

  const [column] = await db
    .select({ name: boardColumns.name })
    .from(boardColumns)
    .innerJoin(boardTasks, eq(boardTasks.columnId, boardColumns.id))
    .where(eq(boardTasks.id, taskId))

  return {
    labelSnapshot: taskLabelRows,
    checklistSnapshot: checklistRows.length > 0 ? { total: checklistRows.length, checked } : {},
    columnName: column?.name ?? null,
  }
}

export async function vaultTask(
  taskId: string,
  projectId: string,
  daysTaken: number | null
) {
  const [task] = await db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))

  if (!task) return null

  const snapshot = await snapshotTaskData(taskId, projectId)

  const [vaulted] = await db.transaction(async (tx) => {
    const result = await tx
      .insert(taskVault)
      .values({
        projectId,
        originalTaskId: taskId,
        name: task.name,
        description: task.description,
        priority: task.priority,
        color: task.color,
        columnName: snapshot.columnName,
        size: task.size,
        daysTaken,
        labelSnapshot: snapshot.labelSnapshot,
        checklistSnapshot: snapshot.checklistSnapshot,
        metadata: task.metadata,
        completedAt: task.completedAt ?? new Date(),
        originalCreatedAt: task.createdAt,
      })
      .returning()

    await tx
      .delete(boardTasks)
      .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))

    return result
  })

  return vaulted
}

export async function vaultTasksBatch(
  projectId: string,
  taskEntries: { taskId: string; daysTaken: number | null }[]
) {
  if (taskEntries.length === 0) return []

  const daysMap = new Map(taskEntries.map(e => [e.taskId, e.daysTaken]))

  const tasks = await Promise.all(
    taskEntries.map(async (entry) => {
      const [task] = await db
        .select()
        .from(boardTasks)
        .where(and(eq(boardTasks.id, entry.taskId), eq(boardTasks.projectId, projectId)))
      return task
    })
  ).then(results => results.filter(Boolean))

  const snapshots = await Promise.all(
    tasks.map(async (task) => {
      const snap = await snapshotTaskData(task.id, projectId)
      return { task, ...snap }
    })
  )

  return db.transaction(async (tx) => {
    const values = snapshots.map(({ task, labelSnapshot, checklistSnapshot, columnName }) => ({
      projectId,
      originalTaskId: task.id,
      name: task.name,
      description: task.description,
      priority: task.priority,
      color: task.color,
      columnName,
      size: task.size,
      daysTaken: daysMap.get(task.id) ?? null,
      labelSnapshot,
      checklistSnapshot,
      metadata: task.metadata,
      completedAt: task.completedAt ?? new Date(),
      originalCreatedAt: task.createdAt,
    }))

    const vaulted = await tx.insert(taskVault).values(values).returning()

    for (const task of tasks) {
      await tx
        .delete(boardTasks)
        .where(and(eq(boardTasks.id, task.id), eq(boardTasks.projectId, projectId)))
    }

    return vaulted
  })
}

export async function restoreFromVault(vaultId: string, projectId: string) {
  const [vaultEntry] = await db
    .select()
    .from(taskVault)
    .where(and(eq(taskVault.id, vaultId), eq(taskVault.projectId, projectId)))

  if (!vaultEntry) return null

  const [maxResult] = await db
    .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))

  return db.transaction(async (tx) => {
    const [restoredTask] = await tx
      .insert(boardTasks)
      .values({
        projectId,
        name: vaultEntry.name,
        description: vaultEntry.description,
        priority: vaultEntry.priority,
        color: vaultEntry.color,
        status: 'todo',
        onTimeline: false,
        orderIndex: maxResult.max + 1,
        metadata: vaultEntry.metadata,
      })
      .returning()

    await tx
      .delete(taskVault)
      .where(eq(taskVault.id, vaultId))

    return restoredTask
  })
}

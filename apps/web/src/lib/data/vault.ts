import { db } from '@/lib/db'
import { taskVault, boardTasks, labels, taskLabels, checklistItems, boardColumns } from '@/lib/db/schema'
import { eq, and, asc, desc, sql, inArray } from 'drizzle-orm'
import { touchProject } from './projects'

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

async function snapshotTaskData(taskId: string) {
  const [taskLabelRows, checklistRows, [column]] = await Promise.all([
    db.select({ name: labels.name, color: labels.color })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(eq(taskLabels.taskId, taskId)),
    db.select({ state: checklistItems.state })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId)),
    db.select({ name: boardColumns.name })
      .from(boardColumns)
      .innerJoin(boardTasks, eq(boardTasks.columnId, boardColumns.id))
      .where(eq(boardTasks.id, taskId)),
  ])

  const checked = checklistRows.filter(r => r.state === 'checked').length

  return {
    labelSnapshot: taskLabelRows,
    checklistSnapshot: checklistRows.length > 0 ? { total: checklistRows.length, checked } : {},
    columnName: column?.name ?? null,
  }
}

async function snapshotTaskDataBatch(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, { labelSnapshot: { name: string; color: string }[]; checklistSnapshot: Record<string, unknown>; columnName: string | null }>()

  const [allLabels, allChecklist, allColumns] = await Promise.all([
    db.select({ taskId: taskLabels.taskId, name: labels.name, color: labels.color })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, taskIds)),
    db.select({ taskId: checklistItems.taskId, state: checklistItems.state })
      .from(checklistItems)
      .where(inArray(checklistItems.taskId, taskIds)),
    db.select({ taskId: boardTasks.id, columnName: boardColumns.name })
      .from(boardColumns)
      .innerJoin(boardTasks, eq(boardTasks.columnId, boardColumns.id))
      .where(inArray(boardTasks.id, taskIds)),
  ])

  const labelsByTask = new Map<string, { name: string; color: string }[]>()
  for (const row of allLabels) {
    if (!labelsByTask.has(row.taskId)) labelsByTask.set(row.taskId, [])
    labelsByTask.get(row.taskId)!.push({ name: row.name, color: row.color })
  }

  const checklistByTask = new Map<string, { total: number; checked: number }>()
  for (const row of allChecklist) {
    if (!checklistByTask.has(row.taskId)) checklistByTask.set(row.taskId, { total: 0, checked: 0 })
    const entry = checklistByTask.get(row.taskId)!
    entry.total++
    if (row.state === 'checked') entry.checked++
  }

  const columnByTask = new Map<string, string>()
  for (const row of allColumns) {
    columnByTask.set(row.taskId, row.columnName)
  }

  const result = new Map<string, { labelSnapshot: { name: string; color: string }[]; checklistSnapshot: Record<string, unknown>; columnName: string | null }>()
  for (const taskId of taskIds) {
    const cl = checklistByTask.get(taskId)
    result.set(taskId, {
      labelSnapshot: labelsByTask.get(taskId) ?? [],
      checklistSnapshot: cl ? { total: cl.total, checked: cl.checked } : {},
      columnName: columnByTask.get(taskId) ?? null,
    })
  }

  return result
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

  const [existingVault] = await db
    .select({ id: taskVault.id })
    .from(taskVault)
    .where(and(eq(taskVault.originalTaskId, taskId), eq(taskVault.projectId, projectId)))
    .limit(1)
  if (existingVault) return null

  const snapshot = await snapshotTaskData(taskId)

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

  await touchProject(projectId, { type: 'task:deleted' })
  return vaulted
}

export async function vaultTasksBatch(
  projectId: string,
  taskEntries: { taskId: string; daysTaken: number | null }[]
) {
  if (taskEntries.length === 0) return []

  const taskIds = taskEntries.map(e => e.taskId)
  const daysMap = new Map(taskEntries.map(e => [e.taskId, e.daysTaken]))

  // 2 queries: batch task fetch + batch snapshot (3 queries inside)
  const [tasks, snapshots] = await Promise.all([
    db.select().from(boardTasks)
      .where(and(inArray(boardTasks.id, taskIds), eq(boardTasks.projectId, projectId))),
    snapshotTaskDataBatch(taskIds),
  ])

  const vaulted = await db.transaction(async (tx) => {
    const values = tasks.map((task) => {
      const snap = snapshots.get(task.id) ?? { labelSnapshot: [], checklistSnapshot: {}, columnName: null }
      return {
        projectId,
        originalTaskId: task.id,
        name: task.name,
        description: task.description,
        priority: task.priority,
        color: task.color,
        columnName: snap.columnName,
        size: task.size,
        daysTaken: daysMap.get(task.id) ?? null,
        labelSnapshot: snap.labelSnapshot,
        checklistSnapshot: snap.checklistSnapshot,
        metadata: task.metadata,
        completedAt: task.completedAt ?? new Date(),
        originalCreatedAt: task.createdAt,
      }
    })

    const result = await tx.insert(taskVault).values(values).returning()

    await tx.delete(boardTasks)
      .where(and(inArray(boardTasks.id, taskIds), eq(boardTasks.projectId, projectId)))

    return result
  })
  await touchProject(projectId, { type: 'task:deleted' })
  return vaulted
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

  // A card with no column is invisible on the board (0409: a restored card
  // sat in the table with column_id NULL and the owner reported it lost).
  // The restore resets status to todo, so the board's first column is where
  // it belongs — never the vault's column_name, which is the Done column it
  // was completed in.
  const [firstColumn] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex))
    .limit(1)

  const restoredTask = await db.transaction(async (tx) => {
    const [task] = await tx
      .insert(boardTasks)
      .values({
        projectId,
        columnId: firstColumn?.id ?? null,
        name: vaultEntry.name,
        description: vaultEntry.description,
        priority: vaultEntry.priority,
        color: vaultEntry.color,
        status: 'todo',
        onTimeline: false,
        size: vaultEntry.size,
        orderIndex: maxResult.max + 1,
        metadata: vaultEntry.metadata,
      })
      .returning()

    await tx
      .delete(taskVault)
      .where(eq(taskVault.id, vaultId))

    return task
  })
  await touchProject(projectId, { type: 'task:created' })
  return restoredTask
}

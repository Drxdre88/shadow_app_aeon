import { db } from '@/lib/db'
import { boardTasks, ganttTasks, boardColumns, labels, taskLabels, taskDependencies, rows, checklistItems } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { touchProject } from './projects'

const DEFAULT_DURATION_DAYS = 2

const PRIORITY_NAME_MAP: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function computeDuration(size: number | null, priority: string): number {
  if (size !== null && size !== undefined && size > 0) return size
  return DEFAULT_DURATION_DAYS
}

export function computeStartDate(
  existingStartDate: Date | null,
  predecessorEndDate: Date | null
): Date {
  if (existingStartDate) return existingStartDate
  if (predecessorEndDate) return predecessorEndDate
  return new Date()
}

export function computeEndDate(startDate: Date, durationDays: number, skipWeekends = true): Date {
  if (!skipWeekends) {
    const ms = durationDays * 24 * 60 * 60 * 1000
    return new Date(startDate.getTime() + ms)
  }
  let remaining = durationDays
  const cursor = new Date(startDate)
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1)
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      remaining -= 1
    }
  }
  return cursor
}

export function skipToWeekday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  if (day === 0) d.setDate(d.getDate() + 1)
  else if (day === 6) d.setDate(d.getDate() + 2)
  return d
}

/**
 * Put one card on the timeline. A card owns at most one bar — `boardTasks`
 * holds a single `ganttTaskId`, so a second bar for the same card orphans the
 * first. When a bar already exists the card is re-linked to it instead of a
 * duplicate being inserted: the two halves of the link can drift apart (a reset
 * nulls `ganttTaskId` while the bar lives on in its view), and re-pushing after
 * a drift must repair the link, not fork it.
 */
export async function pushTaskToGantt(
  boardTaskId: string,
  projectId: string,
  ganttViewId: string,
  rowId: string,
  ganttTaskClientId: string
) {
  const [boardTask] = await db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.id, boardTaskId), eq(boardTasks.projectId, projectId)))

  if (!boardTask) throw new Error('Board task not found')
  if (boardTask.ganttTaskId) throw new Error('Task already on Gantt')

  const [existingBar] = await db
    .select()
    .from(ganttTasks)
    .where(and(eq(ganttTasks.projectId, projectId), eq(ganttTasks.boardTaskId, boardTaskId)))

  const duration = computeDuration(boardTask.size, boardTask.priority)
  const start = existingBar ? existingBar.startDate : computeStartDate(boardTask.startDate, null)
  const end = existingBar ? existingBar.endDate : (boardTask.endDate || computeEndDate(start, duration))

  const ganttTask = await db.transaction(async (tx) => {
    let bar = existingBar
    if (!bar) {
      const [created] = await tx
        .insert(ganttTasks)
        .values({
          id: ganttTaskClientId,
          projectId,
          rowId,
          boardTaskId,
          name: boardTask.name,
          startDate: start,
          endDate: end,
          color: boardTask.color,
          progress: boardTask.status === 'done' ? 100 : 0,
        })
        .returning()
      bar = created
    }

    await tx
      .update(boardTasks)
      .set({
        ganttTaskId: bar.id,
        onTimeline: true,
        startDate: start,
        endDate: end,
        updatedAt: new Date(),
      })
      .where(and(eq(boardTasks.id, boardTaskId), eq(boardTasks.projectId, projectId)))

    return bar
  })

  await touchProject(projectId, { type: 'task:updated' })
  return ganttTask
}

export async function syncBoardStatusToGantt(boardTaskId: string, newStatus: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId })
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (!boardTask?.ganttTaskId) return

  if (newStatus === 'done') {
    await db
      .update(ganttTasks)
      .set({ progress: 100, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  } else {
    const summary = await getChecklistProgress(boardTaskId)
    await db
      .update(ganttTasks)
      .set({ progress: summary, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  }
}

export async function syncGanttDatesToBoard(ganttTaskId: string, startDate: Date, endDate: Date) {
  const [ganttTask] = await db
    .select({ boardTaskId: ganttTasks.boardTaskId })
    .from(ganttTasks)
    .where(eq(ganttTasks.id, ganttTaskId))

  if (!ganttTask?.boardTaskId) return

  await db
    .update(boardTasks)
    .set({ startDate, endDate, updatedAt: new Date() })
    .where(eq(boardTasks.id, ganttTask.boardTaskId))
}

export async function syncChecklistToGanttProgress(taskId: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId, status: boardTasks.status })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))

  if (!boardTask?.ganttTaskId) return
  if (boardTask.status === 'done') return

  const progress = await getChecklistProgress(taskId)
  await db
    .update(ganttTasks)
    .set({ progress, updatedAt: new Date() })
    .where(eq(ganttTasks.id, boardTask.ganttTaskId))
}

async function getChecklistProgress(taskId: string): Promise<number> {
  const items = await db
    .select({ state: checklistItems.state })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  if (items.length === 0) return 0
  const checked = items.filter((i) => i.state === 'checked').length
  return Math.round((checked / items.length) * 100)
}

export async function deleteLinkedGanttTask(boardTaskId: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId })
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (boardTask?.ganttTaskId) {
    await db.delete(ganttTasks).where(eq(ganttTasks.id, boardTask.ganttTaskId))
  }
}

export type GroupByMode = 'column' | 'label' | 'dependency' | 'priority'

type Executor = Pick<typeof db, 'select' | 'insert' | 'delete'>

/**
 * Build a view's lanes. The generate-then-prune pair runs in one transaction —
 * a failure between them used to leave the excluded sections behind as lanes
 * the user explicitly opted out of.
 */
export async function generateRowsForView(
  projectId: string,
  ganttViewId: string,
  groupBy: GroupByMode,
  excludedSections?: string[]
): Promise<{ id: string; name: string; color: string; orderIndex: number }[]> {
  return db.transaction(async (tx) => {
    let generated: { id: string; name: string; color: string; orderIndex: number }[]
    switch (groupBy) {
      case 'column':
        generated = await generateRowsByColumn(tx, projectId, ganttViewId)
        break
      case 'label':
        generated = await generateRowsByLabel(tx, projectId, ganttViewId)
        break
      case 'priority':
        generated = await generateRowsByPriority(tx, projectId, ganttViewId)
        break
      case 'dependency':
        generated = await generateRowsByDependencyChain(tx, projectId, ganttViewId)
        break
    }

    if (!excludedSections || excludedSections.length === 0) return generated

    const excludedSet = new Set(excludedSections)
    const excludedRows = generated.filter((r) => excludedSet.has(r.name))
    if (excludedRows.length > 0) {
      await tx
        .delete(rows)
        .where(inArray(rows.id, excludedRows.map((r) => r.id)))
    }
    return generated.filter((r) => !excludedSet.has(r.name))
  })
}

async function generateRowsByColumn(tx: Executor, projectId: string, ganttViewId: string) {
  const columns = await tx
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(boardColumns.orderIndex)

  const rowValues = columns.map((col, i) => ({
    projectId,
    ganttViewId,
    name: col.name,
    color: col.color,
    orderIndex: i,
  }))

  if (rowValues.length === 0) return []

  const created = await tx.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByLabel(tx: Executor, projectId: string, ganttViewId: string) {
  const projectLabels = await tx
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))

  const rowValues = [
    ...projectLabels.map((l, i) => ({
      projectId,
      ganttViewId,
      name: l.name,
      color: l.color,
      orderIndex: i,
    })),
    {
      projectId,
      ganttViewId,
      name: 'Untagged',
      color: 'slate' as string,
      orderIndex: projectLabels.length,
    },
  ]

  const created = await tx.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByPriority(tx: Executor, projectId: string, ganttViewId: string) {
  const priorities = [
    { name: 'Urgent', color: 'red' },
    { name: 'High', color: 'orange' },
    { name: 'Medium', color: 'blue' },
    { name: 'Low', color: 'slate' },
  ]

  const rowValues = priorities.map((p, i) => ({
    projectId,
    ganttViewId,
    name: p.name,
    color: p.color,
    orderIndex: i,
  }))

  const created = await tx.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByDependencyChain(tx: Executor, projectId: string, ganttViewId: string) {
  const deps = await tx
    .select()
    .from(taskDependencies)
    .innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))
    .where(eq(boardTasks.projectId, projectId))

  const tasks = await tx
    .select({ id: boardTasks.id, name: boardTasks.name })
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))

  const hasBlocker = new Set<string>()
  const graph = new Map<string, string[]>()
  for (const dep of deps) {
    hasBlocker.add(dep.task_dependencies.blockedTaskId)
    const children = graph.get(dep.task_dependencies.blockerTaskId) || []
    children.push(dep.task_dependencies.blockedTaskId)
    graph.set(dep.task_dependencies.blockerTaskId, children)
  }

  const rootTasks = tasks.filter((t) => !hasBlocker.has(t.id))
  const visited = new Set<string>()
  const chains: { rootName: string; taskIds: string[] }[] = []

  for (const root of rootTasks) {
    if (visited.has(root.id)) continue
    const chain: string[] = []
    const queue = [root.id]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      chain.push(current)
      const children = graph.get(current) || []
      queue.push(...children)
    }
    chains.push({ rootName: root.name, taskIds: chain })
  }

  const independentTasks = tasks.filter((t) => !visited.has(t.id))
  if (independentTasks.length > 0) {
    chains.push({ rootName: 'Independent', taskIds: independentTasks.map((t) => t.id) })
  }

  const rowValues = chains.map((chain, i) => ({
    projectId,
    ganttViewId,
    name: chain.rootName,
    color: 'purple' as string,
    orderIndex: i,
  }))

  if (rowValues.length === 0) return []

  const created = await tx.insert(rows).values(rowValues).returning()
  return created
}

export type TaskOrder = 'column' | 'alphabetical'

/**
 * Put every unscheduled card on the timeline.
 *
 * Idempotent: cards that already own a bar are skipped, so a re-run (a retried
 * action, a second view built over the same board) inserts nothing rather than
 * minting a duplicate bar per card and repointing `boardTasks.ganttTaskId` at
 * it — which left the earlier bars alive but unreachable from the board. Both
 * halves of the link count as "already scheduled", since a reset can null
 * `ganttTaskId` while the bar survives.
 */
export async function bulkPushAllTasksToGantt(
  projectId: string,
  ganttViewId: string,
  viewRows: { id: string; name: string }[],
  groupBy: GroupByMode,
  taskOrder: TaskOrder = 'column',
  allowWeekends = false,
  allowOverlap = false
) {
  if (viewRows.length === 0) return []

  const allTasksRaw = await db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))

  const existingBars = await db
    .select({ boardTaskId: ganttTasks.boardTaskId })
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId))

  const alreadyScheduled = new Set(
    existingBars.map((b) => b.boardTaskId).filter((id): id is string => !!id)
  )

  const allTasks = allTasksRaw.filter(
    (t) => t.status !== 'done' && !t.ganttTaskId && !alreadyScheduled.has(t.id)
  )
  if (allTasks.length === 0) return []

  const allColumns = await db.select().from(boardColumns).where(eq(boardColumns.projectId, projectId))

  const allTaskLabels = groupBy === 'label'
    ? await db.select().from(taskLabels).where(
        inArray(taskLabels.taskId, allTasks.map((t) => t.id))
      )
    : []

  const allLabels = groupBy === 'label'
    ? await db.select().from(labels).where(eq(labels.projectId, projectId))
    : []

  const taskLabelMap = new Map<string, string>()
  for (const tl of allTaskLabels) {
    if (!taskLabelMap.has(tl.taskId)) {
      const label = allLabels.find((l) => l.id === tl.labelId)
      if (label) taskLabelMap.set(tl.taskId, label.name)
    }
  }

  const columnNameMap = new Map<string, string>()
  const columnOrderMap = new Map<string, number>()
  for (const col of allColumns) {
    columnNameMap.set(col.id, col.name)
    columnOrderMap.set(col.id, col.orderIndex)
  }

  function resolveRow(task: typeof allTasks[0]): string | null {
    switch (groupBy) {
      case 'column': {
        const colName = task.columnId ? columnNameMap.get(task.columnId) : null
        const match = colName ? viewRows.find((r) => r.name === colName) : null
        return match?.id ?? null
      }
      case 'label': {
        const labelName = taskLabelMap.get(task.id)
        if (!labelName) {
          const untagged = viewRows.find((r) => r.name === 'Untagged')
          return untagged?.id ?? null
        }
        const match = viewRows.find((r) => r.name === labelName)
        return match?.id ?? null
      }
      case 'priority': {
        const name = PRIORITY_NAME_MAP[task.priority] ?? 'Medium'
        const match = viewRows.find((r) => r.name === name)
        return match?.id ?? null
      }
      case 'dependency':
        return viewRows[0]?.id ?? null
    }
  }

  const rowGroups = new Map<string, typeof allTasks>()
  for (const task of allTasks) {
    const rowId = resolveRow(task)
    if (!rowId) continue
    const group = rowGroups.get(rowId) || []
    group.push(task)
    rowGroups.set(rowId, group)
  }

  for (const [, group] of rowGroups) {
    if (taskOrder === 'alphabetical') {
      group.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      group.sort((a, b) => {
        const colA = a.columnId ? (columnOrderMap.get(a.columnId) ?? -1) : -1
        const colB = b.columnId ? (columnOrderMap.get(b.columnId) ?? -1) : -1
        if (colA !== colB) return colB - colA
        return a.orderIndex - b.orderIndex
      })
    }
  }

  const skipWk = !allowWeekends
  let today = new Date()
  today.setHours(0, 0, 0, 0)
  if (skipWk) today = skipToWeekday(today)

  const ganttValues: {
    projectId: string
    rowId: string
    boardTaskId: string
    name: string
    startDate: Date
    endDate: Date
    color: string
    progress: number
  }[] = []

  for (const [rowId, group] of rowGroups) {
    if (allowOverlap) {
      for (const task of group) {
        const duration = computeDuration(task.size, task.priority)
        let start = computeStartDate(task.startDate, null)
        if (skipWk) start = skipToWeekday(start)
        const end = task.endDate || computeEndDate(start, duration, skipWk)
        ganttValues.push({
          projectId,
          rowId,
          boardTaskId: task.id,
          name: task.name,
          startDate: start,
          endDate: end,
          color: task.color,
          progress: task.status === 'done' ? 100 : 0,
        })
      }
    } else {
      let cursor = new Date(today)
      for (const task of group) {
        const duration = computeDuration(task.size, task.priority)
        if (skipWk) cursor = skipToWeekday(cursor)
        const start = new Date(cursor)
        const end = computeEndDate(start, duration, skipWk)
        ganttValues.push({
          projectId,
          rowId,
          boardTaskId: task.id,
          name: task.name,
          startDate: start,
          endDate: end,
          color: task.color,
          progress: task.status === 'done' ? 100 : 0,
        })
        cursor = end
      }
    }
  }

  if (ganttValues.length === 0) return []

  const created = await db.transaction(async (tx) => {
    const inserted = await tx.insert(ganttTasks).values(ganttValues).returning()

    const ganttByBoardId = new Map<string, string>()
    for (const gt of inserted) {
      if (gt.boardTaskId) ganttByBoardId.set(gt.boardTaskId, gt.id)
    }

    const taskIdsToUpdate = [...ganttByBoardId.keys()]
    if (taskIdsToUpdate.length > 0) {
      const caseParts = taskIdsToUpdate.map((tid) => sql`WHEN ${tid} THEN ${ganttByBoardId.get(tid)!}::uuid`)
      await tx
        .update(boardTasks)
        .set({
          ganttTaskId: sql`CASE ${boardTasks.id} ${sql.join(caseParts, sql` `)} END`,
          onTimeline: true,
          updatedAt: new Date(),
        })
        .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, taskIdsToUpdate)))
    }

    return inserted
  })

  await touchProject(projectId, { type: 'task:updated' })
  return created
}

export async function findRowTargetForTask(
  boardTaskId: string,
  projectId: string,
  ganttViewId: string,
  groupBy: GroupByMode
): Promise<string | null> {
  const viewRows = await db
    .select()
    .from(rows)
    .where(and(eq(rows.projectId, projectId), eq(rows.ganttViewId, ganttViewId)))

  if (viewRows.length === 0) return null

  const [boardTask] = await db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (!boardTask) return null

  switch (groupBy) {
    case 'column': {
      const [col] = boardTask.columnId
        ? await db.select().from(boardColumns).where(eq(boardColumns.id, boardTask.columnId))
        : []
      if (!col) return viewRows[0].id
      const match = viewRows.find((r) => r.name === col.name)
      return match?.id ?? viewRows[0].id
    }
    case 'label': {
      const tl = await db
        .select({ labelId: taskLabels.labelId })
        .from(taskLabels)
        .where(eq(taskLabels.taskId, boardTaskId))

      if (tl.length === 0) {
        const untagged = viewRows.find((r) => r.name === 'Untagged')
        return untagged?.id ?? viewRows[viewRows.length - 1].id
      }

      const [firstLabel] = await db
        .select()
        .from(labels)
        .where(eq(labels.id, tl[0].labelId))

      if (!firstLabel) return viewRows[0].id
      const match = viewRows.find((r) => r.name === firstLabel.name)
      return match?.id ?? viewRows[0].id
    }
    case 'priority': {
      const name = PRIORITY_NAME_MAP[boardTask.priority] ?? 'Medium'
      const match = viewRows.find((r) => r.name === name)
      return match?.id ?? viewRows[0].id
    }
    case 'dependency': {
      return viewRows[0].id
    }
  }
}

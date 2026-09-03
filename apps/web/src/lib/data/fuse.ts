import { db } from '@/lib/db'
import {
  boardTasks,
  taskLabels,
  taskAssignees,
  taskVirtualAssignees,
  checklistItems,
  taskDependencies,
  taskComments,
  agentSessions,
  memories,
  ganttTasks,
} from '@/lib/db/schema'
import { eq, and, or, inArray, isNull, sql } from 'drizzle-orm'
import { touchProject } from './projects'
import { mergeTaskFields, unionIds, mergeChecklistOrder, repointDependencies } from '@/lib/utils/fuseRules'
import { FUSE_SNAPSHOT_LIMITS, type FuseSnapshot } from './validators'

// Card fusion: the dragged card (source) is absorbed into the card it was
// dropped on (survivor). ONE transaction — the survivor's merged scalars,
// the relation unions, every re-pointed child row and the source's deletion
// either all land or none do. Every table with a FK onto board_tasks is
// handled explicitly here, cascade or not:
//   task_labels / task_assignees / task_virtual_assignees  union onto survivor
//   checklist_items                                         re-pointed, re-ordered
//   task_dependencies                                       re-pointed (self-refs + dupes dropped)
//   task_comments, agent_sessions, memories                 re-pointed
//   gantt_tasks (boardTaskId cascade)                       snapshotted, dies with the source
// The snapshot returned lets unfuseTasks (unfuse.ts) put it all back.

export type BoardTaskRow = typeof boardTasks.$inferSelect

export interface FuseResult {
  survivor: BoardTaskRow
  labelIds: string[]
  snapshot: FuseSnapshot
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

const touches = (e: { blockerTaskId: string; blockedTaskId: string }, id: string) => e.blockerTaskId === id || e.blockedTaskId === id

interface SourceCounts {
  labels: number
  assignees: number
  virtualAssignees: number
  checklist: number
  edges: number
  comments: number
  sessions: number
  memories: number
  ganttRows: number
}

/**
 * A fusion whose snapshot would blow a fuseSnapshotSchema cap could never be
 * undone — refuse it instead. Only the SOURCE's rows count: the survivor's
 * checklist is renumbered on undo, not snapshotted, so a small card can fuse
 * into a large one. The offending counts ride on the error for the caller.
 */
export function assertFusable(counts: SourceCounts): void {
  const limits = FUSE_SNAPSHOT_LIMITS
  const tooLarge =
    counts.labels > limits.labels ||
    counts.assignees > limits.assignees ||
    counts.virtualAssignees > limits.assignees ||
    counts.checklist > limits.childRows ||
    counts.edges > limits.childRows ||
    counts.comments > limits.childRows ||
    counts.sessions > limits.childRows ||
    counts.memories > limits.childRows ||
    counts.ganttRows > limits.ganttRows
  if (tooLarge) throw Object.assign(new Error('Card too large to fuse safely'), { counts, limits })
}

function serializeSourceRow(row: BoardTaskRow): FuseSnapshot['source'] {
  return {
    id: row.id,
    columnId: row.columnId,
    ganttTaskId: row.ganttTaskId,
    name: row.name,
    description: row.description,
    status: row.status,
    priority: row.priority,
    color: row.color,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    onTimeline: row.onTimeline,
    size: row.size,
    progress: row.progress,
    orderIndex: row.orderIndex,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: iso(row.completedAt),
    estimateMinutes: row.estimateMinutes,
    scheduleMode: row.scheduleMode,
    constraintType: row.constraintType,
    constraintDate: iso(row.constraintDate),
    computedStart: iso(row.computedStart),
    computedEnd: iso(row.computedEnd),
    totalFloatMin: row.totalFloatMin,
    isMilestone: row.isMilestone,
    ownerResourceId: row.ownerResourceId,
    startedAt: iso(row.startedAt),
  }
}

export async function fuseTasks(projectId: string, survivorId: string, sourceId: string, name: string): Promise<FuseResult> {
  if (survivorId === sourceId) throw new Error('A card cannot be fused into itself')

  const result = await db.transaction(async (tx) => {
    // Two fusions of the same source serialise here, so the second re-reads
    // the pair after the first has committed and finds the source gone.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sourceId}))`)
    const pair = [survivorId, sourceId]
    const rows = await tx
      .select()
      .from(boardTasks)
      .where(and(inArray(boardTasks.id, pair), eq(boardTasks.projectId, projectId), isNull(boardTasks.archivedAt)))
    const survivor = rows.find((r) => r.id === survivorId)
    const source = rows.find((r) => r.id === sourceId)
    if (!survivor || !source) throw new Error('Card not found')

    const labelRows = await tx.select().from(taskLabels).where(inArray(taskLabels.taskId, pair))
    const assigneeRows = await tx.select().from(taskAssignees).where(inArray(taskAssignees.taskId, pair))
    const virtualRows = await tx.select().from(taskVirtualAssignees).where(inArray(taskVirtualAssignees.taskId, pair))
    const checklistRows = await tx
      .select({ id: checklistItems.id, taskId: checklistItems.taskId, groupName: checklistItems.groupName, orderIndex: checklistItems.orderIndex })
      .from(checklistItems)
      .where(inArray(checklistItems.taskId, pair))
    const edgeRows = await tx
      .select({ blockerTaskId: taskDependencies.blockerTaskId, blockedTaskId: taskDependencies.blockedTaskId })
      .from(taskDependencies)
      .where(or(inArray(taskDependencies.blockerTaskId, pair), inArray(taskDependencies.blockedTaskId, pair)))
    const commentRows = await tx.select({ id: taskComments.id }).from(taskComments).where(eq(taskComments.taskId, sourceId))
    const sessionRows = await tx.select({ id: agentSessions.id }).from(agentSessions).where(eq(agentSessions.taskId, sourceId))
    const memoryRows = await tx.select({ id: memories.id }).from(memories).where(eq(memories.taskId, sourceId))
    const ganttRows = await tx.select().from(ganttTasks).where(eq(ganttTasks.boardTaskId, sourceId))

    const sourceEdges = edgeRows.filter((e) => touches(e, sourceId))
    const survivorEdges = edgeRows.filter((e) => touches(e, survivorId))
    const survivorItems = checklistRows.filter((r) => r.taskId === survivorId)
    const sourceItems = checklistRows.filter((r) => r.taskId === sourceId)
    assertFusable({
      labels: labelRows.filter((r) => r.taskId === sourceId).length,
      assignees: assigneeRows.filter((r) => r.taskId === sourceId).length,
      virtualAssignees: virtualRows.filter((r) => r.taskId === sourceId).length,
      checklist: sourceItems.length,
      edges: sourceEdges.length,
      comments: commentRows.length,
      sessions: sessionRows.length,
      memories: memoryRows.length,
      ganttRows: ganttRows.length,
    })

    const patch = mergeTaskFields(survivor, source, name)
    const [updated] = await tx
      .update(boardTasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(boardTasks.id, survivorId), eq(boardTasks.projectId, projectId)))
      .returning()
    if (!updated) throw new Error('Card not found')

    const survivorLabelIds = labelRows.filter((r) => r.taskId === survivorId).map((r) => r.labelId)
    const sourceLabelIds = labelRows.filter((r) => r.taskId === sourceId).map((r) => r.labelId)
    const labelIds = unionIds(survivorLabelIds, sourceLabelIds)
    const addedLabelIds = labelIds.filter((id) => !survivorLabelIds.includes(id))
    if (addedLabelIds.length > 0) {
      await tx.insert(taskLabels).values(addedLabelIds.map((labelId) => ({ taskId: survivorId, labelId }))).onConflictDoNothing()
    }

    const survivorUserIds = new Set(assigneeRows.filter((r) => r.taskId === survivorId).map((r) => r.userId))
    const sourceAssignees = assigneeRows.filter((r) => r.taskId === sourceId)
    const addedAssignees = sourceAssignees.filter((r) => !survivorUserIds.has(r.userId))
    if (addedAssignees.length > 0) {
      await tx
        .insert(taskAssignees)
        .values(addedAssignees.map((r) => ({ taskId: survivorId, userId: r.userId, assignedBy: r.assignedBy, assignedAt: r.assignedAt })))
        .onConflictDoNothing()
    }

    const survivorVirtualIds = new Set(virtualRows.filter((r) => r.taskId === survivorId).map((r) => r.virtualMemberId))
    const sourceVirtual = virtualRows.filter((r) => r.taskId === sourceId)
    const addedVirtual = sourceVirtual.filter((r) => !survivorVirtualIds.has(r.virtualMemberId))
    if (addedVirtual.length > 0) {
      await tx
        .insert(taskVirtualAssignees)
        .values(addedVirtual.map((r) => ({ taskId: survivorId, virtualMemberId: r.virtualMemberId, assignedBy: r.assignedBy, assignedAt: r.assignedAt })))
        .onConflictDoNothing()
    }

    const current = new Map(checklistRows.map((r) => [r.id, r]))
    const moved = mergeChecklistOrder(survivorItems, sourceItems).filter((item) => {
      const was = current.get(item.id)
      return !(was && was.taskId === survivorId && was.orderIndex === item.orderIndex)
    })
    if (moved.length > 0) {
      const values = sql.join(moved.map((item) => sql`(${item.id}::uuid, ${item.orderIndex}::integer)`), sql`, `)
      await tx.execute(sql`
        update checklist_items as c
        set task_id = ${survivorId}::uuid, order_index = v.order_index
        from (values ${values}) as v(id, order_index)
        where c.id = v.id and c.task_id in (${survivorId}::uuid, ${sourceId}::uuid)
      `)
    }

    const insertedEdges = repointDependencies(sourceEdges, survivorEdges, sourceId, survivorId)
    if (insertedEdges.length > 0) {
      await tx.insert(taskDependencies).values(insertedEdges).onConflictDoNothing()
    }

    if (commentRows.length > 0) {
      await tx.update(taskComments).set({ taskId: survivorId }).where(eq(taskComments.taskId, sourceId))
    }
    if (sessionRows.length > 0) {
      await tx.update(agentSessions).set({ taskId: survivorId }).where(eq(agentSessions.taskId, sourceId))
    }
    if (memoryRows.length > 0) {
      await tx.update(memories).set({ taskId: survivorId }).where(eq(memories.taskId, sourceId))
    }

    const deleted = await tx.delete(boardTasks).where(and(eq(boardTasks.id, sourceId), eq(boardTasks.projectId, projectId)))
    if (deleted.rowCount !== 1) throw new Error('The absorbed card changed underneath the fusion; nothing was merged')

    const snapshot: FuseSnapshot = {
      projectId,
      survivorId,
      sourceId,
      survivorBefore: {
        name: survivor.name,
        description: survivor.description,
        priority: survivor.priority as FuseSnapshot['survivorBefore']['priority'],
        startDate: iso(survivor.startDate),
        endDate: iso(survivor.endDate),
        onTimeline: survivor.onTimeline,
        size: survivor.size,
        estimateMinutes: survivor.estimateMinutes,
      },
      source: serializeSourceRow(source),
      sourceLabelIds,
      sourceAssignees: sourceAssignees.map((r) => ({ userId: r.userId, assignedBy: r.assignedBy, assignedAt: r.assignedAt.toISOString() })),
      sourceVirtualAssignees: sourceVirtual.map((r) => ({ virtualMemberId: r.virtualMemberId, assignedBy: r.assignedBy, assignedAt: r.assignedAt.toISOString() })),
      addedLabelIds,
      addedAssigneeIds: addedAssignees.map((r) => r.userId),
      addedVirtualAssigneeIds: addedVirtual.map((r) => r.virtualMemberId),
      checklist: sourceItems.map((r) => ({ id: r.id, taskId: r.taskId, orderIndex: r.orderIndex })),
      sourceEdges,
      insertedEdges,
      commentIds: commentRows.map((r) => r.id),
      sessionIds: sessionRows.map((r) => r.id),
      memoryIds: memoryRows.map((r) => r.id),
      ganttRows: ganttRows.map((g) => ({
        id: g.id,
        rowId: g.rowId,
        name: g.name,
        description: g.description,
        startDate: g.startDate.toISOString(),
        endDate: g.endDate.toISOString(),
        color: g.color,
        progress: g.progress,
        metadata: (g.metadata ?? {}) as Record<string, unknown>,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
    }

    return { survivor: updated, labelIds, snapshot }
  })

  await touchProject(projectId, { type: 'task:deleted' })
  return result
}

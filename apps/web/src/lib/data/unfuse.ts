import { db } from '@/lib/db'
import {
  boardTasks,
  boardColumns,
  labels,
  taskLabels,
  taskAssignees,
  taskVirtualAssignees,
  checklistItems,
  taskDependencies,
  taskComments,
  agentSessions,
  memories,
  ganttTasks,
  rows,
} from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { touchProject } from './projects'
import type { FuseSnapshot } from './validators'

// The undo of fuseTasks, from the snapshot it returned. ONE transaction.
// Anything the snapshot points at that has since vanished (a deleted
// column, label, gantt row, the other end of a dependency) is skipped or
// nulled rather than failing the whole restore — an undo that lands 95% is
// worth more than one that refuses.

const date = (s: string | null): Date | null => (s ? new Date(s) : null)

export async function unfuseTasks(snapshot: FuseSnapshot): Promise<void> {
  const { projectId, survivorId, sourceId, source } = snapshot

  await db.transaction(async (tx) => {
    const [survivor] = await tx
      .select({ id: boardTasks.id })
      .from(boardTasks)
      .where(and(eq(boardTasks.id, survivorId), eq(boardTasks.projectId, projectId)))
    if (!survivor) throw new Error('The fused card no longer exists')

    const existing = await tx.select({ id: boardTasks.id }).from(boardTasks).where(eq(boardTasks.id, sourceId))
    if (existing.length > 0) throw new Error('The absorbed card has already been restored')

    const columnRows = source.columnId
      ? await tx.select({ id: boardColumns.id }).from(boardColumns).where(and(eq(boardColumns.id, source.columnId), eq(boardColumns.projectId, projectId)))
      : []
    const columnId = columnRows.length > 0 ? source.columnId : null

    await tx.insert(boardTasks).values({
      id: source.id,
      projectId,
      columnId,
      ganttTaskId: null,
      name: source.name,
      description: source.description,
      status: source.status,
      priority: source.priority,
      color: source.color,
      startDate: date(source.startDate),
      endDate: date(source.endDate),
      onTimeline: source.onTimeline,
      size: source.size,
      progress: source.progress,
      orderIndex: source.orderIndex,
      metadata: source.metadata,
      createdAt: new Date(source.createdAt),
      updatedAt: new Date(),
      completedAt: date(source.completedAt),
      estimateMinutes: source.estimateMinutes,
      scheduleMode: source.scheduleMode,
      constraintType: source.constraintType,
      constraintDate: date(source.constraintDate),
      computedStart: date(source.computedStart),
      computedEnd: date(source.computedEnd),
      totalFloatMin: source.totalFloatMin,
      isMilestone: source.isMilestone,
      ownerResourceId: null,
      startedAt: date(source.startedAt),
    })

    if (snapshot.ganttRows.length > 0) {
      const rowIds = snapshot.ganttRows.map((g) => g.rowId).filter((id): id is string => !!id)
      const liveRows = rowIds.length > 0
        ? new Set((await tx.select({ id: rows.id }).from(rows).where(inArray(rows.id, rowIds))).map((r) => r.id))
        : new Set<string>()
      await tx.insert(ganttTasks).values(snapshot.ganttRows.map((g) => ({
        id: g.id,
        projectId,
        rowId: g.rowId && liveRows.has(g.rowId) ? g.rowId : null,
        boardTaskId: sourceId,
        name: g.name,
        description: g.description,
        startDate: new Date(g.startDate),
        endDate: new Date(g.endDate),
        color: g.color,
        progress: g.progress,
        metadata: g.metadata,
        createdAt: new Date(g.createdAt),
        updatedAt: new Date(g.updatedAt),
      }))).onConflictDoNothing()
      if (source.ganttTaskId && snapshot.ganttRows.some((g) => g.id === source.ganttTaskId)) {
        await tx.update(boardTasks).set({ ganttTaskId: source.ganttTaskId }).where(eq(boardTasks.id, sourceId))
      }
    }

    const before = snapshot.survivorBefore
    await tx
      .update(boardTasks)
      .set({
        name: before.name,
        description: before.description,
        priority: before.priority,
        startDate: date(before.startDate),
        endDate: date(before.endDate),
        onTimeline: before.onTimeline,
        size: before.size,
        estimateMinutes: before.estimateMinutes,
        updatedAt: new Date(),
      })
      .where(and(eq(boardTasks.id, survivorId), eq(boardTasks.projectId, projectId)))

    if (snapshot.addedLabelIds.length > 0) {
      await tx.delete(taskLabels).where(and(eq(taskLabels.taskId, survivorId), inArray(taskLabels.labelId, snapshot.addedLabelIds)))
    }
    if (snapshot.addedAssigneeIds.length > 0) {
      await tx.delete(taskAssignees).where(and(eq(taskAssignees.taskId, survivorId), inArray(taskAssignees.userId, snapshot.addedAssigneeIds)))
    }
    if (snapshot.addedVirtualAssigneeIds.length > 0) {
      await tx.delete(taskVirtualAssignees).where(and(eq(taskVirtualAssignees.taskId, survivorId), inArray(taskVirtualAssignees.virtualMemberId, snapshot.addedVirtualAssigneeIds)))
    }

    if (snapshot.sourceLabelIds.length > 0) {
      const live = await tx
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.projectId, projectId), inArray(labels.id, snapshot.sourceLabelIds)))
      if (live.length > 0) {
        await tx.insert(taskLabels).values(live.map((l) => ({ taskId: sourceId, labelId: l.id }))).onConflictDoNothing()
      }
    }
    if (snapshot.sourceAssignees.length > 0) {
      await tx
        .insert(taskAssignees)
        .values(snapshot.sourceAssignees.map((a) => ({ taskId: sourceId, userId: a.userId, assignedBy: a.assignedBy, assignedAt: new Date(a.assignedAt) })))
        .onConflictDoNothing()
    }
    if (snapshot.sourceVirtualAssignees.length > 0) {
      await tx
        .insert(taskVirtualAssignees)
        .values(snapshot.sourceVirtualAssignees.map((a) => ({ taskId: sourceId, virtualMemberId: a.virtualMemberId, assignedBy: a.assignedBy, assignedAt: new Date(a.assignedAt) })))
        .onConflictDoNothing()
    }

    for (const item of snapshot.checklist) {
      await tx
        .update(checklistItems)
        .set({ taskId: item.taskId, orderIndex: item.orderIndex })
        .where(and(eq(checklistItems.id, item.id), inArray(checklistItems.taskId, [survivorId, sourceId])))
    }

    for (const edge of snapshot.insertedEdges) {
      await tx
        .delete(taskDependencies)
        .where(and(eq(taskDependencies.blockerTaskId, edge.blockerTaskId), eq(taskDependencies.blockedTaskId, edge.blockedTaskId)))
    }
    if (snapshot.sourceEdges.length > 0) {
      const endpoints = [...new Set(snapshot.sourceEdges.flatMap((e) => [e.blockerTaskId, e.blockedTaskId]))]
      const live = new Set((await tx
        .select({ id: boardTasks.id })
        .from(boardTasks)
        .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, endpoints)))).map((r) => r.id))
      const restorable = snapshot.sourceEdges.filter((e) => live.has(e.blockerTaskId) && live.has(e.blockedTaskId))
      if (restorable.length > 0) {
        await tx.insert(taskDependencies).values(restorable).onConflictDoNothing()
      }
    }

    if (snapshot.commentIds.length > 0) {
      await tx.update(taskComments).set({ taskId: sourceId }).where(and(inArray(taskComments.id, snapshot.commentIds), eq(taskComments.taskId, survivorId)))
    }
    if (snapshot.sessionIds.length > 0) {
      await tx.update(agentSessions).set({ taskId: sourceId }).where(and(inArray(agentSessions.id, snapshot.sessionIds), eq(agentSessions.taskId, survivorId)))
    }
    if (snapshot.memoryIds.length > 0) {
      await tx.update(memories).set({ taskId: sourceId }).where(and(inArray(memories.id, snapshot.memoryIds), eq(memories.taskId, survivorId)))
    }
  })

  await touchProject(projectId, { type: 'task:created' })
}

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
  virtualMembers,
  projectGroups,
} from '@/lib/db/schema'
import { eq, and, or, inArray, sql } from 'drizzle-orm'
import { touchProject } from './projects'
import { findAssignableMembers } from './members'
import type { FuseSnapshot } from './validators'

// The undo of fuseTasks, from the snapshot it returned. ONE transaction.
//
// Trust model. The snapshot sits on the client between the fusion and the
// undo, so every id inside it is attacker-controlled by any editor of the
// project. We do not sign it; we verify it on replay, and that is complete
// because every statement below is scoped to projectId or to the
// survivor/source pair. Two kinds of bad input, two responses:
//   * structural inconsistency — an id outside the pair, source.id that is
//     not sourceId, an edge touching neither card, a gantt row that already
//     exists. fuseTasks can never produce these, so the snapshot is REJECTED
//     before anything is written.
//   * drift — a column, label, gantt row, member or dependency endpoint that
//     has vanished or left the project since the fusion. That is legitimate,
//     so the element is SKIPPED or nulled: an undo that lands 95% is worth
//     more than one that refuses.
// An HMAC would only prove fuseTasks produced the snapshot; it would not
// catch drift, and the scoping is needed regardless — so verification on
// replay is the single mechanism, and it has to stay complete: a new
// snapshot field must arrive here with its own scope check. Attribution is
// never taken from the snapshot either: restored assignments are credited to
// the actor performing the undo.

const date = (s: string | null): Date | null => (s ? new Date(s) : null)

type Edge = { blockerTaskId: string; blockedTaskId: string }
const touches = (e: Edge, ids: readonly string[]) => ids.includes(e.blockerTaskId) || ids.includes(e.blockedTaskId)
const selfRef = (e: Edge) => e.blockerTaskId === e.blockedTaskId

function assertConsistent(snapshot: FuseSnapshot): void {
  const { survivorId, sourceId, source } = snapshot
  const pair = [survivorId, sourceId]
  if (survivorId === sourceId) throw new Error('Snapshot is inconsistent: survivor and source are the same card')
  if (source.id !== sourceId) throw new Error('Snapshot is inconsistent: source row does not match sourceId')
  if (snapshot.checklist.some((c) => !pair.includes(c.taskId))) {
    throw new Error('Snapshot is inconsistent: checklist item points outside the fused pair')
  }
  if (snapshot.insertedEdges.some((e) => !touches(e, pair) || selfRef(e))) {
    throw new Error('Snapshot is inconsistent: dependency does not touch the fused pair')
  }
  if (snapshot.sourceEdges.some((e) => !touches(e, [sourceId]) || selfRef(e))) {
    throw new Error('Snapshot is inconsistent: source dependency does not touch the absorbed card')
  }
}

export async function unfuseTasks(snapshot: FuseSnapshot, actorId: string): Promise<void> {
  assertConsistent(snapshot)
  const { projectId, survivorId, sourceId, source } = snapshot

  const memberIds = snapshot.sourceAssignees.length > 0
    ? new Set((await findAssignableMembers(projectId)).map((m) => m.userId))
    : new Set<string>()

  await db.transaction(async (tx) => {
    // Same key as fuseTasks: a double undo queues behind the first and then
    // meets the friendly "already restored" guard instead of a PK violation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sourceId}))`)
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
      id: sourceId,
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

    if (columnId) {
      await tx.execute(sql`
        update board_tasks as t
        set order_index = v.rn - 1
        from (
          select id, row_number() over (order by order_index, created_at, id) as rn
          from board_tasks
          where project_id = ${projectId} and column_id = ${columnId} and archived_at is null
        ) as v
        where t.id = v.id and t.archived_at is null and t.order_index <> v.rn - 1
      `)
    }

    if (snapshot.ganttRows.length > 0) {
      const ganttIds = snapshot.ganttRows.map((g) => g.id)
      const taken = await tx.select({ id: ganttTasks.id }).from(ganttTasks).where(inArray(ganttTasks.id, ganttIds))
      if (taken.length > 0) throw new Error('Snapshot is inconsistent: a timeline row of the absorbed card already exists')
      const rowIds = snapshot.ganttRows.map((g) => g.rowId).filter((id): id is string => !!id)
      const liveRows = rowIds.length > 0
        ? new Set((await tx
            .select({ id: rows.id })
            .from(rows)
            .where(and(eq(rows.projectId, projectId), inArray(rows.id, rowIds)))).map((r) => r.id))
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
      })))
      if (source.ganttTaskId && ganttIds.includes(source.ganttTaskId)) {
        await tx
          .update(boardTasks)
          .set({ ganttTaskId: source.ganttTaskId })
          .where(and(eq(boardTasks.id, sourceId), eq(boardTasks.projectId, projectId)))
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
    const restorableAssignees = snapshot.sourceAssignees.filter((a) => memberIds.has(a.userId))
    if (restorableAssignees.length > 0) {
      await tx
        .insert(taskAssignees)
        .values(restorableAssignees.map((a) => ({ taskId: sourceId, userId: a.userId, assignedBy: actorId, assignedAt: new Date(a.assignedAt) })))
        .onConflictDoNothing()
    }
    if (snapshot.sourceVirtualAssignees.length > 0) {
      const assignable = new Set((await tx
        .select({ id: virtualMembers.id })
        .from(virtualMembers)
        .innerJoin(projectGroups, and(eq(projectGroups.groupId, virtualMembers.realmId), eq(projectGroups.projectId, projectId)))
        .where(inArray(virtualMembers.id, snapshot.sourceVirtualAssignees.map((a) => a.virtualMemberId)))).map((r) => r.id))
      const restorable = snapshot.sourceVirtualAssignees.filter((a) => assignable.has(a.virtualMemberId))
      if (restorable.length > 0) {
        await tx
          .insert(taskVirtualAssignees)
          .values(restorable.map((a) => ({ taskId: sourceId, virtualMemberId: a.virtualMemberId, assignedBy: actorId, assignedAt: new Date(a.assignedAt) })))
          .onConflictDoNothing()
      }
    }

    if (snapshot.checklist.length > 0) {
      const values = sql.join(
        snapshot.checklist.map((c) => sql`(${c.id}::uuid, ${c.taskId}::uuid, ${c.orderIndex}::integer)`),
        sql`, `,
      )
      await tx.execute(sql`
        update checklist_items as c
        set task_id = v.task_id, order_index = v.order_index
        from (values ${values}) as v(id, task_id, order_index)
        where c.id = v.id and c.task_id in (${survivorId}::uuid, ${sourceId}::uuid)
      `)
      // The survivor's own items kept their relative order through the fusion,
      // so closing the gaps the absorbed items leave restores their placement.
      await tx.execute(sql`
        update checklist_items as c
        set order_index = v.rn - 1
        from (
          select id, row_number() over (order by order_index, id) as rn
          from checklist_items
          where task_id = ${survivorId}::uuid
        ) as v
        where c.id = v.id and c.order_index <> v.rn - 1
      `)
    }

    const endpoints = [...new Set([...snapshot.insertedEdges, ...snapshot.sourceEdges].flatMap((e) => [e.blockerTaskId, e.blockedTaskId]))]
    if (endpoints.length > 0) {
      const live = new Set((await tx
        .select({ id: boardTasks.id })
        .from(boardTasks)
        .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, endpoints)))).map((r) => r.id))
      const bothLive = (e: Edge) => live.has(e.blockerTaskId) && live.has(e.blockedTaskId)
      const removable = snapshot.insertedEdges.filter(bothLive)
      if (removable.length > 0) {
        await tx
          .delete(taskDependencies)
          .where(or(...removable.map((e) => and(eq(taskDependencies.blockerTaskId, e.blockerTaskId), eq(taskDependencies.blockedTaskId, e.blockedTaskId)))))
      }
      const restorable = snapshot.sourceEdges.filter(bothLive)
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

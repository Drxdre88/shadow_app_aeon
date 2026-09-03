import { describe, it, expect, beforeEach, vi } from 'vitest'

// fuseTasks: one transaction that merges the survivor, re-points every child
// row of the source, deletes the source, and hands back a snapshot the undo
// can replay. The db is a recording mock: selects are answered per table from
// a queue in the order fuseTasks issues them, every write is captured by
// table, raw statements (the lock, the checklist re-point) are captured whole.

const reads = new Map<unknown, unknown[][]>()
const writes: { kind: 'update' | 'insert' | 'delete'; table: unknown; payload?: unknown }[] = []
const executes: SQL[] = []
let transactionCalls = 0
let deleteRowCount = 1

vi.mock('@/lib/db', () => {
  function makeSelectChain() {
    let rows: unknown[] = []
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = (table: unknown) => { rows = reads.get(table)?.shift() ?? []; return chain }
    chain.where = pass
    chain.orderBy = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function makeUpdateChain(table: unknown) {
    const chain: Record<string, unknown> = {}
    let patch: unknown
    chain.set = (p: unknown) => { patch = p; return chain }
    chain.where = () => { writes.push({ kind: 'update', table, payload: patch }); return chain }
    chain.returning = () => Promise.resolve([{ id: 'updated-row', ...(patch as object) }])
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  function makeInsertChain(table: unknown) {
    const chain: Record<string, unknown> = {}
    chain.values = (v: unknown) => { writes.push({ kind: 'insert', table, payload: v }); return chain }
    chain.onConflictDoNothing = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  function makeDeleteChain(table: unknown) {
    const chain: Record<string, unknown> = {}
    chain.where = () => { writes.push({ kind: 'delete', table }); return chain }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ rowCount: deleteRowCount })
    return chain
  }
  const tx = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((table: unknown) => makeUpdateChain(table)),
    insert: vi.fn((table: unknown) => makeInsertChain(table)),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
    execute: vi.fn((q: SQL) => { executes.push(q); return Promise.resolve([]) }),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => { transactionCalls++; return fn(tx) }),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { fuseTasks, assertFusable } from '../fuse'
import { FUSE_SNAPSHOT_LIMITS } from '../validators'
import { touchProject } from '../projects'
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
} from '@/lib/db/schema'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const SURVIVOR = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const LABEL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LABEL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const now = new Date('2026-09-02T10:00:00.000Z')

function taskRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    projectId: PROJECT,
    columnId: OTHER,
    ganttTaskId: null,
    name: `card ${id}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    color: 'purple',
    startDate: null,
    endDate: null,
    onTimeline: false,
    size: null,
    progress: null,
    orderIndex: 0,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    estimateMinutes: null,
    scheduleMode: 'auto',
    constraintType: 'asap',
    constraintDate: null,
    computedStart: null,
    computedEnd: null,
    totalFloatMin: null,
    isMilestone: false,
    ownerResourceId: null,
    startedAt: null,
    ...over,
  }
}

const read = (table: unknown, result: unknown[]) => {
  const queue = reads.get(table) ?? []
  queue.push(result)
  reads.set(table, queue)
}
/** The pair read every fusion starts with; a table left unqueued answers with no rows. */
const queueCards = (rows: unknown[] = [taskRow(SURVIVOR), taskRow(SOURCE)]) => read(boardTasks, rows)
const sourceChecklist = (count: number, groupName = 'Checklist') =>
  Array.from({ length: count }, (_, i) => ({ id: `x${i}`, taskId: SOURCE, groupName, orderIndex: i }))

const writesTo = (table: unknown, kind?: 'update' | 'insert' | 'delete') =>
  writes.filter((w) => w.table === table && (!kind || w.kind === kind))
const toQuery = (q: SQL) => new PgDialect().sqlToQuery(q)

beforeEach(() => {
  reads.clear()
  writes.length = 0
  executes.length = 0
  transactionCalls = 0
  deleteRowCount = 1
  vi.clearAllMocks()
})

describe('fuseTasks', () => {
  it('takes the advisory lock on the source before reading anything', async () => {
    queueCards()
    await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')
    const lock = toQuery(executes[0])
    expect(lock.sql).toBe('select pg_advisory_xact_lock(hashtext($1))')
    expect(lock.params).toEqual([SOURCE])
    expect(transactionCalls).toBe(1)
  })

  it('merges the survivor\'s scalars, deletes the source, broadcasts once — all in one transaction', async () => {
    queueCards([
      taskRow(SURVIVOR, { priority: 'low', description: 'keep', startDate: new Date('2026-09-10'), endDate: new Date('2026-09-12'), size: 2 }),
      taskRow(SOURCE, { priority: 'urgent', description: 'more', startDate: new Date('2026-09-01'), endDate: null, size: 3, onTimeline: true }),
    ])

    const result = await fuseTasks(PROJECT, SURVIVOR, SOURCE, '  Fused card ')

    expect(transactionCalls).toBe(1)
    const [survivorUpdate] = writesTo(boardTasks, 'update')
    expect(survivorUpdate.payload).toMatchObject({
      name: 'Fused card',
      description: 'keep\n\n---\n\nmore',
      priority: 'urgent',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-12'),
      onTimeline: true,
      size: 5,
      estimateMinutes: null,
    })
    expect(writesTo(boardTasks, 'delete')).toHaveLength(1)
    // The delete is the LAST write: every child row is re-pointed first.
    expect(writes[writes.length - 1]).toMatchObject({ kind: 'delete', table: boardTasks })
    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(touchProject).toHaveBeenCalledWith(PROJECT, { type: 'task:deleted' })
    expect(result.snapshot.survivorBefore).toMatchObject({ name: `card ${SURVIVOR}`, priority: 'low', size: 2 })
    expect(result.snapshot.source.id).toBe(SOURCE)
  })

  it('unions labels and assignees onto the survivor and records what was added', async () => {
    queueCards()
    read(taskLabels, [
      { taskId: SURVIVOR, labelId: LABEL_A },
      { taskId: SOURCE, labelId: LABEL_A },
      { taskId: SOURCE, labelId: LABEL_B },
    ])
    read(taskAssignees, [{ taskId: SOURCE, userId: OTHER, assignedBy: null, assignedAt: now }])
    read(taskVirtualAssignees, [
      { taskId: SURVIVOR, virtualMemberId: LABEL_B, assignedBy: null, assignedAt: now },
      { taskId: SOURCE, virtualMemberId: LABEL_B, assignedBy: null, assignedAt: now },
    ])

    const result = await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')

    expect(result.labelIds).toEqual([LABEL_A, LABEL_B])
    expect(writesTo(taskLabels, 'insert')[0].payload).toEqual([{ taskId: SURVIVOR, labelId: LABEL_B }])
    expect(writesTo(taskAssignees, 'insert')[0].payload).toEqual([{ taskId: SURVIVOR, userId: OTHER, assignedBy: null, assignedAt: now }])
    // The virtual member was already on the survivor — nothing to insert.
    expect(writesTo(taskVirtualAssignees, 'insert')).toHaveLength(0)
    expect(result.snapshot.addedLabelIds).toEqual([LABEL_B])
    expect(result.snapshot.addedAssigneeIds).toEqual([OTHER])
    expect(result.snapshot.addedVirtualAssigneeIds).toEqual([])
    expect(result.snapshot.sourceLabelIds).toEqual([LABEL_A, LABEL_B])
  })

  it('moves the source\'s checklist after the survivor\'s, group by group, and re-points dependencies minus self-refs', async () => {
    queueCards()
    read(checklistItems, [
      { id: 's1', taskId: SURVIVOR, groupName: 'Checklist', orderIndex: 0 },
      { id: 'x1', taskId: SOURCE, groupName: 'Checklist', orderIndex: 0 },
      { id: 'x2', taskId: SOURCE, groupName: 'QA', orderIndex: 1 },
    ])
    read(taskDependencies, [
      { blockerTaskId: SOURCE, blockedTaskId: OTHER },
      { blockerTaskId: SURVIVOR, blockedTaskId: SOURCE },
    ])
    read(taskComments, [{ id: 'c1' }])
    read(agentSessions, [{ id: 'sess1' }])
    read(memories, [{ id: 'm1' }])

    const result = await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')

    // Both moved items travel in ONE set-based UPDATE ... FROM (VALUES ...),
    // pair-scoped, never one statement per row. executes[0] is the lock.
    expect(writesTo(checklistItems, 'update')).toHaveLength(0)
    expect(executes).toHaveLength(2)
    const checklistQuery = toQuery(executes[1])
    expect(checklistQuery.sql).toMatch(/update checklist_items as c[\s\S]*from \(values/)
    expect(checklistQuery.params).toEqual([SURVIVOR, 'x1', 1, 'x2', 2, SURVIVOR, SOURCE])
    expect(writesTo(taskDependencies, 'insert')[0].payload).toEqual([{ blockerTaskId: SURVIVOR, blockedTaskId: OTHER }])
    expect(writesTo(taskComments, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    expect(writesTo(agentSessions, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    expect(writesTo(memories, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    // Only the absorbed card's items are snapshotted; the survivor's are renumbered on undo.
    expect(result.snapshot.checklist).toEqual([
      { id: 'x1', taskId: SOURCE, orderIndex: 0 },
      { id: 'x2', taskId: SOURCE, orderIndex: 1 },
    ])
    expect(result.snapshot.insertedEdges).toEqual([{ blockerTaskId: SURVIVOR, blockedTaskId: OTHER }])
    expect(result.snapshot.sourceEdges).toHaveLength(2)
    expect(result.snapshot.commentIds).toEqual(['c1'])
    expect(result.snapshot.sessionIds).toEqual(['sess1'])
    expect(result.snapshot.memoryIds).toEqual(['m1'])
  })

  it('re-points a long checklist in a single statement', async () => {
    queueCards()
    read(checklistItems, sourceChecklist(300))

    await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')

    expect(executes).toHaveLength(2)
    expect(writesTo(checklistItems)).toHaveLength(0)
    expect(toQuery(executes[1]).params).toHaveLength(1 + 300 * 2 + 2)
  })

  it('refuses a card whose undo snapshot would exceed a cap, before writing anything', async () => {
    queueCards()
    read(checklistItems, sourceChecklist(FUSE_SNAPSHOT_LIMITS.childRows + 1))
    await expect(fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')).rejects.toThrow('Card too large to fuse safely')
    expect(writes).toHaveLength(0)
    expect(executes).toHaveLength(1)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('caps only the absorbed card: a one-item card fuses into a survivor far past the limit', async () => {
    const survivorItems = Array.from({ length: 600 }, (_, i) => ({ id: `s${i}`, taskId: SURVIVOR, groupName: 'Checklist', orderIndex: i }))
    queueCards()
    read(checklistItems, [...survivorItems, { id: 'x0', taskId: SOURCE, groupName: 'Checklist', orderIndex: 0 }])

    const result = await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')

    expect(result.snapshot.checklist).toEqual([{ id: 'x0', taskId: SOURCE, orderIndex: 0 }])
    expect(toQuery(executes[1]).params).toEqual([SURVIVOR, 'x0', 600, SURVIVOR, SOURCE])
    expect(writesTo(boardTasks, 'delete')).toHaveLength(1)
  })

  it('assertFusable mirrors every fuseSnapshotSchema cap and reports the counts on the error', () => {
    const ok = { labels: 0, assignees: 0, virtualAssignees: 0, checklist: 0, edges: 0, comments: 0, sessions: 0, memories: 0, ganttRows: 0 }
    const L = FUSE_SNAPSHOT_LIMITS
    expect(() => assertFusable({ ...ok, labels: L.labels, assignees: L.assignees, virtualAssignees: L.assignees, checklist: L.childRows, edges: L.childRows, comments: L.childRows, sessions: L.childRows, memories: L.childRows, ganttRows: L.ganttRows })).not.toThrow()
    for (const over of [
      { labels: L.labels + 1 }, { assignees: L.assignees + 1 }, { virtualAssignees: L.assignees + 1 }, { checklist: L.childRows + 1 },
      { edges: L.childRows + 1 }, { comments: L.childRows + 1 }, { sessions: L.childRows + 1 }, { memories: L.childRows + 1 }, { ganttRows: L.ganttRows + 1 },
    ]) {
      expect(() => assertFusable({ ...ok, ...over })).toThrow('Card too large to fuse safely')
    }
    const counts = { ...ok, checklist: L.childRows + 1 }
    let thrown: unknown
    try { assertFusable(counts) } catch (e) { thrown = e }
    expect(thrown).toMatchObject({ counts, limits: L })
  })

  it('refuses when either card is missing from the project, writing nothing', async () => {
    queueCards([taskRow(SURVIVOR)])
    await expect(fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')).rejects.toThrow('Card not found')
    expect(writes).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('fails the transaction when the source delete touches no row', async () => {
    deleteRowCount = 0
    queueCards()
    await expect(fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')).rejects.toThrow('changed underneath')
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('refuses to fuse a card into itself before touching the db', async () => {
    await expect(fuseTasks(PROJECT, SURVIVOR, SURVIVOR, 'Fused')).rejects.toThrow('itself')
    expect(transactionCalls).toBe(0)
  })
})

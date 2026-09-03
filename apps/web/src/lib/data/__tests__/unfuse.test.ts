import { describe, it, expect, beforeEach, vi } from 'vitest'

// unfuseTasks replays a client-held snapshot, so every id in it is untrusted.
// The db is a recording mock: selects are answered per table from a queue in
// the order unfuseTasks issues them, every write is captured by table, and
// raw statements (the set-based checklist re-point) are captured whole.

const reads = new Map<unknown, unknown[][]>()
const writes: { kind: 'update' | 'insert' | 'delete'; table: unknown; payload?: unknown }[] = []
const executes: SQL[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function makeSelectChain() {
    let rows: unknown[] = []
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = (table: unknown) => { rows = reads.get(table)?.shift() ?? []; return chain }
    chain.innerJoin = pass
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
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
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
vi.mock('../members', () => ({ findAssignableMembers: vi.fn().mockResolvedValue([]) }))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { unfuseTasks } from '../unfuse'
import { touchProject } from '../projects'
import { findAssignableMembers } from '../members'
import {
  boardTasks,
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
  boardColumns,
} from '@/lib/db/schema'
import type { FuseSnapshot } from '../validators'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const SURVIVOR = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const STRANGER = '55555555-5555-4555-8555-555555555555'
const FOREIGN_A = '66666666-6666-4666-8666-666666666666'
const FOREIGN_B = '77777777-7777-4777-8777-777777777777'
const VM_IN = '88888888-8888-4888-8888-888888888888'
const VM_OUT = '99999999-9999-4999-8999-999999999999'
const GANTT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const COL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const uuidAt = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const restore = (snapshot: FuseSnapshot) => unfuseTasks(snapshot, ACTOR)

const ISO = '2026-09-01T00:00:00.000Z'

function makeSnapshot(over: Partial<FuseSnapshot> = {}): FuseSnapshot {
  return {
    projectId: PROJECT,
    survivorId: SURVIVOR,
    sourceId: SOURCE,
    survivorBefore: { name: 'Survivor before', description: null, priority: 'low', startDate: null, endDate: null, onTimeline: false, size: null, estimateMinutes: null },
    source: {
      id: SOURCE, columnId: null, ganttTaskId: null, name: 'Absorbed', description: null, status: 'todo', priority: 'medium', color: 'purple',
      startDate: null, endDate: null, onTimeline: false, size: null, progress: null, orderIndex: 0, metadata: {},
      createdAt: ISO, updatedAt: ISO, completedAt: null, estimateMinutes: null,
      scheduleMode: 'auto', constraintType: 'asap', constraintDate: null, computedStart: null, computedEnd: null, totalFloatMin: null,
      isMilestone: false, ownerResourceId: null, startedAt: null,
    },
    sourceLabelIds: [], sourceAssignees: [], sourceVirtualAssignees: [],
    addedLabelIds: [], addedAssigneeIds: [], addedVirtualAssigneeIds: [],
    checklist: [], sourceEdges: [], insertedEdges: [], commentIds: [], sessionIds: [], memoryIds: [], ganttRows: [],
    ...over,
  }
}

const read = (table: unknown, result: unknown[]) => {
  const queue = reads.get(table) ?? []
  queue.push(result)
  reads.set(table, queue)
}
/** The two board_tasks reads every restore starts with: survivor present, source gone. */
const queueCards = () => {
  read(boardTasks, [{ id: SURVIVOR }])
  read(boardTasks, [])
}
const writesTo = (table: unknown, kind?: 'update' | 'insert' | 'delete') =>
  writes.filter((w) => w.table === table && (!kind || w.kind === kind))
const toQuery = (q: SQL) => new PgDialect().sqlToQuery(q)

beforeEach(() => {
  reads.clear()
  writes.length = 0
  executes.length = 0
  transactionCalls = 0
  vi.clearAllMocks()
  vi.mocked(findAssignableMembers).mockResolvedValue([])
})

describe('unfuseTasks', () => {
  it('takes the same advisory lock as the fusion, keyed on the source, before reading anything', async () => {
    queueCards()
    await restore(makeSnapshot())
    expect(transactionCalls).toBe(1)
    expect(executes).toHaveLength(1)
    const lock = toQuery(executes[0])
    expect(lock.sql).toBe('select pg_advisory_xact_lock(hashtext($1))')
    expect(lock.params).toEqual([SOURCE])
  })

  it('re-inserts the source, rolls the survivor back and re-points every child row in one transaction', async () => {
    queueCards()
    read(boardTasks, [{ id: SURVIVOR }, { id: SOURCE }, { id: OTHER }])
    const snapshot = makeSnapshot({
      checklist: [
        { id: 'c1', taskId: SURVIVOR, orderIndex: 0 },
        { id: 'c2', taskId: SOURCE, orderIndex: 0 },
      ],
      insertedEdges: [{ blockerTaskId: SURVIVOR, blockedTaskId: OTHER }],
      sourceEdges: [
        { blockerTaskId: SOURCE, blockedTaskId: OTHER },
        { blockerTaskId: STRANGER, blockedTaskId: SOURCE },
      ],
      commentIds: ['k1'], sessionIds: ['s1'], memoryIds: ['m1'],
    })

    await restore(snapshot)

    expect(transactionCalls).toBe(1)
    expect(writesTo(boardTasks, 'insert')[0].payload).toMatchObject({ id: SOURCE, projectId: PROJECT, name: 'Absorbed', ganttTaskId: null })
    expect(writesTo(boardTasks, 'update')[0].payload).toMatchObject({ name: 'Survivor before', priority: 'low' })

    // executes: the lock, the checklist re-point, the survivor renumber.
    expect(executes).toHaveLength(3)
    const checklist = toQuery(executes[1])
    expect(checklist.sql).toMatch(/update checklist_items as c[\s\S]*from \(values[\s\S]*c\.task_id in/)
    expect(checklist.params).toEqual(['c1', SURVIVOR, 0, 'c2', SOURCE, 0, SURVIVOR, SOURCE])
    const renumber = toQuery(executes[2])
    expect(renumber.sql).toMatch(/update checklist_items as c[\s\S]*row_number\(\) over \(order by order_index, id\)[\s\S]*where task_id = \$1::uuid[\s\S]*c\.order_index <> v\.rn - 1/)
    expect(renumber.params).toEqual([SURVIVOR])

    expect(writesTo(taskDependencies, 'delete')).toHaveLength(1)
    // The edge whose other end (STRANGER) is not a live card of the project is dropped.
    expect(writesTo(taskDependencies, 'insert')[0].payload).toEqual([{ blockerTaskId: SOURCE, blockedTaskId: OTHER }])

    expect(writesTo(taskComments, 'update')[0].payload).toEqual({ taskId: SOURCE })
    expect(writesTo(agentSessions, 'update')[0].payload).toEqual({ taskId: SOURCE })
    expect(writesTo(memories, 'update')[0].payload).toEqual({ taskId: SOURCE })
    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(touchProject).toHaveBeenCalledWith(PROJECT, { type: 'task:created' })
  })

  it('rejects a forged dependency that touches neither card, before the transaction opens', async () => {
    const forged = makeSnapshot({ insertedEdges: [{ blockerTaskId: FOREIGN_A, blockedTaskId: FOREIGN_B }] })
    await expect(restore(forged)).rejects.toThrow('does not touch the fused pair')
    expect(transactionCalls).toBe(0)
    expect(writes).toHaveLength(0)
    expect(writesTo(taskDependencies, 'delete')).toHaveLength(0)

    const forgedSource = makeSnapshot({ sourceEdges: [{ blockerTaskId: SURVIVOR, blockedTaskId: FOREIGN_A }] })
    await expect(restore(forgedSource)).rejects.toThrow('does not touch the absorbed card')
    expect(transactionCalls).toBe(0)
  })

  it('rejects a checklist item re-pointed outside the fused pair', async () => {
    const forged = makeSnapshot({ checklist: [{ id: 'c1', taskId: FOREIGN_A, orderIndex: 0 }] })
    await expect(restore(forged)).rejects.toThrow('outside the fused pair')
    expect(transactionCalls).toBe(0)
    expect(writes).toHaveLength(0)
    expect(executes).toHaveLength(0)
  })

  it('rejects a source row whose id disagrees with sourceId, and a pair that is one card', async () => {
    const mismatched = makeSnapshot()
    mismatched.source = { ...mismatched.source, id: FOREIGN_A }
    await expect(restore(mismatched)).rejects.toThrow('does not match sourceId')
    await expect(restore(makeSnapshot({ sourceId: SURVIVOR, source: { ...makeSnapshot().source, id: SURVIVOR } }))).rejects.toThrow('same card')
    expect(transactionCalls).toBe(0)
    expect(writes).toHaveLength(0)
  })

  it('performs no delete for a re-pointed edge whose other end is not a live card of the project', async () => {
    queueCards()
    read(boardTasks, [{ id: SURVIVOR }, { id: SOURCE }])
    await restore(makeSnapshot({ insertedEdges: [{ blockerTaskId: SURVIVOR, blockedTaskId: FOREIGN_A }] }))
    expect(writesTo(taskDependencies, 'delete')).toHaveLength(0)
    expect(writesTo(taskDependencies, 'insert')).toHaveLength(0)
  })

  it('renumbers the destination column contiguously after the insert, only when the column still exists', async () => {
    const withColumn = () => {
      const snap = makeSnapshot()
      snap.source = { ...snap.source, columnId: COL }
      return snap
    }
    queueCards()
    read(boardColumns, [{ id: COL }])
    await restore(withColumn())
    expect(writesTo(boardTasks, 'insert')[0].payload).toMatchObject({ columnId: COL })
    expect(executes).toHaveLength(2)
    const renumber = toQuery(executes[1])
    expect(renumber.sql).toMatch(/update board_tasks as t[\s\S]*row_number\(\) over \(order by order_index, created_at, id\)[\s\S]*where t\.id = v\.id and t\.archived_at is null and t\.order_index <> v\.rn - 1/)
    // Archived cards keep their old index and never take a slot from the live ones.
    expect(renumber.sql).toMatch(/where project_id = \$1 and column_id = \$2 and archived_at is null/)
    expect(renumber.params).toEqual([PROJECT, COL])

    executes.length = 0
    writes.length = 0
    queueCards()
    read(boardColumns, [])
    await restore(withColumn())
    expect(writesTo(boardTasks, 'insert')[0].payload).toMatchObject({ columnId: null })
    expect(executes).toHaveLength(1)
  })

  it('restores only assignees who are still project members and virtual members still in a realm of the project', async () => {
    queueCards()
    vi.mocked(findAssignableMembers).mockResolvedValue([{ userId: OTHER }] as never)
    read(virtualMembers, [{ id: VM_IN }])
    await restore(makeSnapshot({
      sourceAssignees: [
        { userId: OTHER, assignedBy: null, assignedAt: ISO },
        { userId: STRANGER, assignedBy: null, assignedAt: ISO },
      ],
      sourceVirtualAssignees: [
        { virtualMemberId: VM_IN, assignedBy: null, assignedAt: ISO },
        { virtualMemberId: VM_OUT, assignedBy: null, assignedAt: ISO },
      ],
    }))
    expect(findAssignableMembers).toHaveBeenCalledWith(PROJECT)
    // Attribution is the undoing actor, never the snapshot's claim.
    expect(writesTo(taskAssignees, 'insert')[0].payload).toEqual([{ taskId: SOURCE, userId: OTHER, assignedBy: ACTOR, assignedAt: new Date(ISO) }])
    expect(writesTo(taskVirtualAssignees, 'insert')[0].payload).toEqual([{ taskId: SOURCE, virtualMemberId: VM_IN, assignedBy: ACTOR, assignedAt: new Date(ISO) }])
  })

  it('skips the member lookup entirely when the source had no assignees', async () => {
    queueCards()
    await restore(makeSnapshot())
    expect(findAssignableMembers).not.toHaveBeenCalled()
    expect(writesTo(taskAssignees)).toHaveLength(0)
  })

  it('rejects a timeline row that already exists and nulls a row the project does not own', async () => {
    const ganttRow = { id: GANTT, rowId: ROW, name: 'bar', description: null, startDate: ISO, endDate: ISO, color: 'purple', progress: 0, metadata: {}, createdAt: ISO, updatedAt: ISO }
    const withGantt = () => {
      const s = makeSnapshot({ ganttRows: [ganttRow] })
      s.source = { ...s.source, ganttTaskId: GANTT }
      return s
    }

    queueCards()
    read(ganttTasks, [{ id: GANTT }])
    await expect(restore(withGantt())).rejects.toThrow('already exists')
    expect(writesTo(ganttTasks, 'insert')).toHaveLength(0)

    writes.length = 0
    queueCards()
    read(ganttTasks, [])
    read(rows, [])
    await restore(withGantt())
    expect(writesTo(ganttTasks, 'insert')[0].payload).toEqual([expect.objectContaining({ id: GANTT, projectId: PROJECT, boardTaskId: SOURCE, rowId: null })])
    expect(writesTo(boardTasks, 'update').map((w) => w.payload)).toContainEqual({ ganttTaskId: GANTT })
  })

  it('issues one statement per table however many rows the snapshot carries', async () => {
    const others = Array.from({ length: 300 }, (_, i) => uuidAt(i))
    queueCards()
    read(boardTasks, [{ id: SURVIVOR }, { id: SOURCE }, ...others.map((id) => ({ id }))])
    await restore(makeSnapshot({
      checklist: others.map((id, i) => ({ id, taskId: i % 2 ? SOURCE : SURVIVOR, orderIndex: i })),
      insertedEdges: others.map((id) => ({ blockerTaskId: SURVIVOR, blockedTaskId: id })),
      sourceEdges: others.map((id) => ({ blockerTaskId: SOURCE, blockedTaskId: id })),
      commentIds: others,
      sessionIds: others,
      memoryIds: others,
    }))
    expect(executes).toHaveLength(3)
    expect(toQuery(executes[1]).params).toHaveLength(300 * 3 + 2)
    expect(writesTo(checklistItems)).toHaveLength(0)
    expect(writesTo(taskDependencies, 'delete')).toHaveLength(1)
    expect(writesTo(taskDependencies, 'insert')).toHaveLength(1)
    expect(writesTo(taskComments, 'update')).toHaveLength(1)
    expect(writesTo(agentSessions, 'update')).toHaveLength(1)
    expect(writesTo(memories, 'update')).toHaveLength(1)
  })

  it('refuses when the fused card is gone or the absorbed card is already back, writing nothing', async () => {
    read(boardTasks, [])
    await expect(restore(makeSnapshot())).rejects.toThrow('no longer exists')
    expect(writes).toHaveLength(0)

    read(boardTasks, [{ id: SURVIVOR }])
    read(boardTasks, [{ id: SOURCE }])
    await expect(restore(makeSnapshot())).rejects.toThrow('already been restored')
    expect(writes).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('a second undo of the same fusion meets the friendly guard after the lock, never the PK', async () => {
    read(boardTasks, [{ id: SURVIVOR }])
    read(boardTasks, [{ id: SOURCE }])
    await expect(restore(makeSnapshot())).rejects.toThrow('The absorbed card has already been restored')
    expect(executes).toHaveLength(1)
    expect(toQuery(executes[0]).sql).toBe('select pg_advisory_xact_lock(hashtext($1))')
    expect(writesTo(boardTasks, 'insert')).toHaveLength(0)
  })
})

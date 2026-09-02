import { describe, it, expect, beforeEach, vi } from 'vitest'

// fuseTasks: one transaction that merges the survivor, re-points every child
// row of the source, deletes the source, and hands back a snapshot the undo
// can replay. The db is a recording mock: selects are answered from a queue
// in the order fuseTasks issues them, every write is captured by table.

const selectResults: unknown[][] = []
const writes: { kind: 'update' | 'insert' | 'delete'; table: unknown; payload?: unknown }[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function makeSelectChain() {
    const rows = selectResults.shift() ?? []
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
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
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  const tx = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((table: unknown) => makeUpdateChain(table)),
    insert: vi.fn((table: unknown) => makeInsertChain(table)),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => { transactionCalls++; return fn(tx) }),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { fuseTasks } from '../fuse'
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

/** Queue the ten selects fuseTasks issues, in order. */
function queueReads(over: Partial<Record<'tasks' | 'labels' | 'assignees' | 'virtual' | 'checklist' | 'edges' | 'comments' | 'sessions' | 'memories' | 'gantt', unknown[]>> = {}) {
  selectResults.push(
    over.tasks ?? [taskRow(SURVIVOR), taskRow(SOURCE)],
    over.labels ?? [],
    over.assignees ?? [],
    over.virtual ?? [],
    over.checklist ?? [],
    over.edges ?? [],
    over.comments ?? [],
    over.sessions ?? [],
    over.memories ?? [],
    over.gantt ?? [],
  )
}

const writesTo = (table: unknown, kind?: 'update' | 'insert' | 'delete') =>
  writes.filter((w) => w.table === table && (!kind || w.kind === kind))

beforeEach(() => {
  selectResults.length = 0
  writes.length = 0
  transactionCalls = 0
  vi.clearAllMocks()
})

describe('fuseTasks', () => {
  it('merges the survivor\'s scalars, deletes the source, broadcasts once — all in one transaction', async () => {
    queueReads({
      tasks: [
        taskRow(SURVIVOR, { priority: 'low', description: 'keep', startDate: new Date('2026-09-10'), endDate: new Date('2026-09-12'), size: 2 }),
        taskRow(SOURCE, { priority: 'urgent', description: 'more', startDate: new Date('2026-09-01'), endDate: null, size: 3, onTimeline: true }),
      ],
    })

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
    queueReads({
      labels: [
        { taskId: SURVIVOR, labelId: LABEL_A },
        { taskId: SOURCE, labelId: LABEL_A },
        { taskId: SOURCE, labelId: LABEL_B },
      ],
      assignees: [
        { taskId: SOURCE, userId: OTHER, assignedBy: null, assignedAt: now },
      ],
      virtual: [
        { taskId: SURVIVOR, virtualMemberId: LABEL_B, assignedBy: null, assignedAt: now },
        { taskId: SOURCE, virtualMemberId: LABEL_B, assignedBy: null, assignedAt: now },
      ],
    })

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
    queueReads({
      checklist: [
        { id: 's1', taskId: SURVIVOR, groupName: 'Checklist', orderIndex: 0 },
        { id: 'x1', taskId: SOURCE, groupName: 'Checklist', orderIndex: 0 },
        { id: 'x2', taskId: SOURCE, groupName: 'QA', orderIndex: 1 },
      ],
      edges: [
        { blockerTaskId: SOURCE, blockedTaskId: OTHER },
        { blockerTaskId: SURVIVOR, blockedTaskId: SOURCE },
      ],
      comments: [{ id: 'c1' }],
      sessions: [{ id: 'sess1' }],
      memories: [{ id: 'm1' }],
    })

    const result = await fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')

    const checklistUpdates = writesTo(checklistItems, 'update').map((w) => w.payload)
    expect(checklistUpdates).toEqual([
      { taskId: SURVIVOR, orderIndex: 1 },
      { taskId: SURVIVOR, orderIndex: 2 },
    ])
    expect(writesTo(taskDependencies, 'insert')[0].payload).toEqual([{ blockerTaskId: SURVIVOR, blockedTaskId: OTHER }])
    expect(writesTo(taskComments, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    expect(writesTo(agentSessions, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    expect(writesTo(memories, 'update')[0].payload).toEqual({ taskId: SURVIVOR })
    expect(result.snapshot.checklist).toEqual([
      { id: 's1', taskId: SURVIVOR, orderIndex: 0 },
      { id: 'x1', taskId: SOURCE, orderIndex: 0 },
      { id: 'x2', taskId: SOURCE, orderIndex: 1 },
    ])
    expect(result.snapshot.insertedEdges).toEqual([{ blockerTaskId: SURVIVOR, blockedTaskId: OTHER }])
    expect(result.snapshot.sourceEdges).toHaveLength(2)
    expect(result.snapshot.commentIds).toEqual(['c1'])
    expect(result.snapshot.sessionIds).toEqual(['sess1'])
    expect(result.snapshot.memoryIds).toEqual(['m1'])
  })

  it('refuses when either card is missing from the project, writing nothing', async () => {
    queueReads({ tasks: [taskRow(SURVIVOR)] })
    await expect(fuseTasks(PROJECT, SURVIVOR, SOURCE, 'Fused')).rejects.toThrow('Card not found')
    expect(writes).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('refuses to fuse a card into itself before touching the db', async () => {
    await expect(fuseTasks(PROJECT, SURVIVOR, SURVIVOR, 'Fused')).rejects.toThrow('itself')
    expect(transactionCalls).toBe(0)
  })
})

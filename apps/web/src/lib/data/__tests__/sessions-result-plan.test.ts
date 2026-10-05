import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// recordSessionResult settles a plan-phase result's Plan checklist, planGate
// and Tower move in the SAME transaction as the session flip; a replay never
// reaches the plan write, and a session whose owner cannot edit the card
// settles without touching it.

type Capture = { op: string; where?: unknown; set?: Record<string, unknown>; values?: unknown; tx: boolean }

const selectQueue: unknown[][] = []
const updateQueue: unknown[][] = []
const captures: Capture[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function chain(op: string, tx: boolean, rows: () => unknown[]) {
    const capture: Capture = { op, tx }
    captures.push(capture)
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.from = pass
    c.orderBy = pass
    c.limit = pass
    c.set = (arg: Record<string, unknown>) => { capture.set = arg; return c }
    c.values = (arg: unknown) => { capture.values = arg; return c }
    c.where = (arg: unknown) => { capture.where = arg; return c }
    c.returning = () => Promise.resolve(rows())
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return c
  }
  const makeDb = (tx: boolean) => ({
    select: vi.fn(() => chain('select', tx, () => selectQueue.shift() ?? [])),
    update: vi.fn(() => chain('update', tx, () => updateQueue.shift() ?? [])),
    insert: vi.fn(() => chain('insert', tx, () => [])),
    delete: vi.fn(() => chain('delete', tx, () => [])),
  })
  return {
    db: {
      ...makeDb(false),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalls++
        return fn(makeDb(true))
      }),
    },
  }
})

vi.mock('../columns', () => ({ findColumns: vi.fn(async () => [{ id: 'tower-col', name: 'Tower' }, { id: 'landing-col', name: 'Landing' }]) }))
vi.mock('../projects', () => ({
  findProjectSettings: vi.fn(async () => ({ boardMode: 'hangar' })),
  touchProject: vi.fn(async () => {}),
  verifyProjectAccess: vi.fn(async () => ({ project: {}, role: 'editor' })),
}))
vi.mock('../bridge', () => ({ syncChecklistToGanttProgress: vi.fn(async () => {}) }))

import { recordSessionResult } from '../sessions'
import { touchProject, verifyProjectAccess } from '../projects'
import { syncChecklistToGanttProgress } from '../bridge'

const compile = (value: unknown) => new PgDialect().sqlToQuery(value as SQL)
const SESSION_ID = '20000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000001'
const PROJECT_ID = '40000000-0000-4000-8000-000000000001'
const PLAN = { status: 'completed' as const, outcome: 'planned' as const, summary: '1. First\n2. Second' }
const planSession = { id: SESSION_ID, userId: 'u-1', status: 'running', taskId: TASK_ID, metadata: { hangar: { objective: 'plan', phase: 'plan' } } }
const card = { id: TASK_ID, projectId: PROJECT_ID, metadata: { hangar: { planGate: { status: 'planning' } } } }
const ofOp = (op: string) => captures.filter((c) => c.op === op)

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateQueue.length = 0
  captures.length = 0
  transactionCalls = 0
})

describe('recordSessionResult — plan settlement', () => {
  it('writes the Plan checklist, planGate and Tower move inside the result transaction', async () => {
    selectQueue.push([planSession], [card], [{ max: -1 }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }], [{ id: TASK_ID, projectId: PROJECT_ID }], [])

    const result = await recordSessionResult(SESSION_ID, PLAN)

    expect(result?.task).toMatchObject({ id: TASK_ID })
    expect(transactionCalls).toBe(1)
    for (const op of ['delete', 'insert']) expect(ofOp(op).every((c) => c.tx)).toBe(true)
    expect(ofOp('insert')[0].values).toEqual([
      expect.objectContaining({ title: 'First', groupName: 'Plan' }),
      expect.objectContaining({ title: 'Second', groupName: 'Plan' }),
    ])
    const [flip, resultPatch, gatePatch] = ofOp('update')
    expect(flip.tx && resultPatch.tx && gatePatch.tx).toBe(true)
    // The Landing move is skipped; the plan write sends the card to Tower.
    expect(resultPatch.set).not.toHaveProperty('columnId')
    expect(gatePatch.set).toMatchObject({ columnId: 'tower-col' })
    expect(compile(gatePatch.set?.metadata).params.join(' ')).toContain('awaiting_approval')
    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(syncChecklistToGanttProgress).toHaveBeenCalledWith(TASK_ID)
  })

  it('never rewrites the plan on a replayed result (guarded flip)', async () => {
    selectQueue.push([{ ...planSession, status: 'succeeded' }], [card])
    updateQueue.push([])

    const result = await recordSessionResult(SESSION_ID, PLAN)

    expect(result).toMatchObject({ task: null })
    expect(ofOp('delete')).toHaveLength(0)
    expect(ofOp('insert')).toHaveLength(0)
    expect(ofOp('update')).toHaveLength(1)
    expect(touchProject).not.toHaveBeenCalled()
    expect(syncChecklistToGanttProgress).not.toHaveBeenCalled()
  })

  it('leaves the card alone when the card was deleted before settlement', async () => {
    selectQueue.push([planSession], [])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])

    await expect(recordSessionResult(SESSION_ID, PLAN)).resolves.toMatchObject({ task: null })
    expect(ofOp('delete')).toHaveLength(0)
    expect(ofOp('update')).toHaveLength(1)
  })

  it.each([
    ['a plan run, not a member', planSession.metadata, null],
    ['a plan run, viewer', planSession.metadata, { project: {}, role: 'viewer' }],
    ['an analysis run (no phase), not a member', { hangar: { objective: 'analysis' } }, null],
    ['a session with no hangar metadata, not a member', {}, null],
  ])('a forged session (%s) settles but never touches the foreign card', async (_label, metadata, access) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce(access as never)
    selectQueue.push([{ ...planSession, metadata }], [card])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    const forged = { ...PLAN, recommended_tasks: [{ title: 'Exfiltrate', objective: 'implement' as const, instruction: 'x' }] }

    const result = await recordSessionResult(SESSION_ID, forged)

    expect(verifyProjectAccess).toHaveBeenCalledWith(PROJECT_ID, 'u-1')
    expect(result).toMatchObject({ session: { status: 'succeeded' }, task: null })
    // Only the session flip: no lastResult/column patch, no planGate, no checklist.
    const updates = ofOp('update')
    expect(updates).toHaveLength(1)
    expect(updates[0].set).not.toHaveProperty('metadata')
    expect(updates[0].set).not.toHaveProperty('columnId')
    expect(ofOp('delete')).toHaveLength(0)
    expect(ofOp('insert')).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot edit'), expect.objectContaining({ taskId: TASK_ID }))
    warn.mockRestore()
  })

  it('routes a completed build run to Landing with no plan write', async () => {
    selectQueue.push([{ ...planSession, metadata: { hangar: { objective: 'implement', phase: 'build' } } }], [card])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }], [{ id: TASK_ID, projectId: PROJECT_ID }])

    await recordSessionResult(SESSION_ID, { ...PLAN, outcome: 'implemented' })

    expect(ofOp('update')[1].set).toMatchObject({ columnId: 'landing-col' })
    expect(ofOp('delete')).toHaveLength(0)
    expect(syncChecklistToGanttProgress).not.toHaveBeenCalled()
  })
})

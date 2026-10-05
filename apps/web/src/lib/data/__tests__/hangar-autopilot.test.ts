import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Plan-then-approve persistence and follow-up cards: the plan lands as the
// card's "Plan" checklist group in one transaction, and follow-ups are linked
// to their parent mission.

type Capture = { op: string; where?: unknown; set?: Record<string, unknown>; values?: unknown }

const selectQueue: unknown[][] = []
const insertQueue: unknown[][] = []
const captures: Capture[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function chain(op: string, rows: () => unknown[]) {
    const capture: Capture = { op }
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
  const makeDb = () => ({
    select: vi.fn(() => chain('select', () => selectQueue.shift() ?? [])),
    update: vi.fn(() => chain('update', () => [])),
    insert: vi.fn(() => chain('insert', () => insertQueue.shift() ?? [])),
    delete: vi.fn(() => chain('delete', () => [])),
  })
  return {
    db: {
      ...makeDb(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalls++
        return fn(makeDb())
      }),
    },
  }
})

vi.mock('../columns', () => ({ findColumns: vi.fn(async () => []) }))
vi.mock('../projects', () => ({ touchProject: vi.fn(async () => {}), findProjectSettings: vi.fn(async () => null) }))
vi.mock('../bridge', () => ({ syncChecklistToGanttProgress: vi.fn(async () => {}) }))

import { db } from '@/lib/db'
import { applyPlanResult, createFollowUpMissionCards, extractPlanSteps, findFollowUpColumnId } from '../hangar-autopilot'
import { preparePlanSettlement } from '../hangar-plan'
import { findColumns } from '../columns'
import { findProjectSettings, touchProject } from '../projects'

const dialect = new PgDialect()
const compile = (value: unknown) => dialect.sqlToQuery(value as SQL)

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  insertQueue.length = 0
  captures.length = 0
  transactionCalls = 0
})

describe('extractPlanSteps', () => {
  it('prefers recommended tasks, joining title and instruction', () => {
    expect(extractPlanSteps({
      summary: '1. ignored',
      recommended_tasks: [
        { title: 'Add the column', objective: 'implement', instruction: 'Use the existing jsonb' },
        { title: 'Write tests', objective: 'implement', instruction: '' },
      ],
    })).toEqual(['Add the column: Use the existing jsonb', 'Write tests'])
  })

  it('falls back to list lines in the summary, then to the whole summary', () => {
    expect(extractPlanSteps({ summary: 'Plan:\n1. First\n2) Second\n- Third\nnot a step' })).toEqual(['First', 'Second', 'Third'])
    expect(extractPlanSteps({ summary: 'Just do the thing.' })).toEqual(['Just do the thing.'])
  })
})

describe('applyPlanResult', () => {
  it('replaces the Plan checklist group, marks the plan awaiting approval and moves the card to Tower on the caller tx', async () => {
    selectQueue.push([{ max: 4 }])
    const plan = { steps: ['Step one: details'], columnId: 'tower-col' }

    const result = await db.transaction((tx) => applyPlanResult(tx, 's-plan', 't-1', plan))

    expect(result).toEqual({ taskId: 't-1', steps: ['Step one: details'], columnId: 'tower-col' })
    expect(transactionCalls).toBe(1)
    const remove = captures.find((c) => c.op === 'delete')
    expect(compile(remove?.where).params).toEqual(['t-1', 'Plan'])
    const insert = captures.find((c) => c.op === 'insert')
    expect(insert?.values).toEqual([expect.objectContaining({ taskId: 't-1', title: 'Step one: details', groupName: 'Plan', orderIndex: 5 })])
    const card = captures.find((c) => c.op === 'update')
    expect(card?.set).toMatchObject({ columnId: 'tower-col' })
    const metadata = compile(card?.set?.metadata)
    expect(metadata.sql).toContain('{hangar,planGate}')
    expect(metadata.params.join(' ')).toContain('awaiting_approval')
    // Realtime is the caller's job, after its transaction commits.
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('preparePlanSettlement', () => {
  const PLAN = { status: 'completed' as const, outcome: 'planned' as const, summary: '1. First\n2. Second' }
  const planSession = { metadata: { hangar: { objective: 'plan', phase: 'plan' } } }

  it('routes a completed planning run to Tower with its steps', async () => {
    vi.mocked(findProjectSettings).mockResolvedValueOnce({ boardMode: 'hangar' } as never)
    vi.mocked(findColumns).mockResolvedValueOnce([{ id: 'tower-col', name: 'Tower' }] as never)
    await expect(preparePlanSettlement(planSession, 'p-1', PLAN)).resolves.toEqual({ steps: ['First', 'Second'], columnId: 'tower-col' })
  })

  it('ignores build runs and plans that did not complete', async () => {
    await expect(preparePlanSettlement({ metadata: { hangar: { phase: 'build' } } }, 'p-1', PLAN)).resolves.toBeNull()
    await expect(preparePlanSettlement(planSession, 'p-1', { ...PLAN, status: 'needs_input', questions: ['Which repo?'] })).resolves.toBeNull()
    expect(findColumns).not.toHaveBeenCalled()
  })
})

describe('follow-up cards', () => {
  it('picks a backlog-style column by name before the leftmost column', async () => {
    selectQueue.push([{ id: 'c-0', name: 'Ideas', orderIndex: 0 }, { id: 'c-1', name: ' Backlog ', orderIndex: 1 }])
    await expect(findFollowUpColumnId('p-1')).resolves.toBe('c-1')
    selectQueue.push([{ id: 'c-0', name: 'Ideas', orderIndex: 0 }])
    await expect(findFollowUpColumnId('p-1')).resolves.toBe('c-0')
  })

  it('creates linked mission cards and records their titles on the parent in one transaction', async () => {
    selectQueue.push([{ max: 2 }])
    insertQueue.push([{ id: 'new-1', name: 'Polish layout' }])

    const created = await createFollowUpMissionCards(
      { id: 'parent', projectId: 'p-1', name: 'Build the board', hangar: { repo: 'aeon', agent: 'claude', model: 'm-1' } },
      [{ title: 'Polish layout', objective: 'implement', instruction: 'Check 390px' }],
      'c-1',
    )

    expect(created).toEqual([{ id: 'new-1', name: 'Polish layout' }])
    expect(transactionCalls).toBe(1)
    const insert = captures.find((c) => c.op === 'insert')
    expect(insert?.values).toEqual([expect.objectContaining({
      projectId: 'p-1',
      columnId: 'c-1',
      name: 'Polish layout',
      orderIndex: 3,
      metadata: { hangar: expect.objectContaining({ objective: 'implement', repo: 'aeon', agent: 'claude', model: 'm-1', instruction: 'Check 390px', autoRun: false, parentTaskId: 'parent' }) },
    })])
    const parent = captures.find((c) => c.op === 'update')
    expect(compile(parent?.set?.metadata).sql).toContain('{hangar,followUpTitles}')
    expect(touchProject).toHaveBeenCalledWith('p-1', { type: 'task:created' })
  })
})

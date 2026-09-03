import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// Actuals pin and never roll (CHR-50): the first transition into in-progress
// stamps started_at, a repeat keeps the original, and no other status touches
// it. Every write surface (actions, REST, MCP) funnels through these three
// data functions, so pinning them here covers all of them.

const setCalls: Record<string, unknown>[] = []
const insertValues: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => {
  function updateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => Promise.resolve([{ id: 'task' }])
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  function insertChain() {
    const chain: Record<string, unknown> = {}
    chain.values = (values: Record<string, unknown>) => {
      insertValues.push(values)
      return chain
    }
    chain.returning = () => Promise.resolve([{ id: 'task' }])
    return chain
  }
  function selectChain() {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([{ max: 4 }])
    return chain
  }
  const tx = {
    update: vi.fn(() => updateChain()),
    insert: vi.fn(() => insertChain()),
    select: vi.fn(() => selectChain()),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import { createTask, createTasksBatch, reorderTasks, updateTask } from '../tasks'

const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const dialect = new PgDialect()

function renderedStartedAt(patch: Record<string, unknown>): string {
  const value = patch.startedAt
  expect(value).toBeInstanceOf(SQL)
  return dialect.sqlToQuery(value as SQL).sql
}

beforeEach(() => {
  vi.clearAllMocks()
  setCalls.length = 0
  insertValues.length = 0
})

describe('updateTask', () => {
  it('stamps started_at only if unset when the status becomes in-progress', async () => {
    await updateTask(TASK_ID, PROJECT_ID, { status: 'in-progress' })
    expect(setCalls).toHaveLength(1)
    const rendered = renderedStartedAt(setCalls[0])
    expect(rendered).toMatch(/coalesce\("board_tasks"\."started_at", \$1::timestamp\)/)
  })

  it('never touches started_at on any other status or on a plain edit', async () => {
    await updateTask(TASK_ID, PROJECT_ID, { status: 'done' })
    await updateTask(TASK_ID, PROJECT_ID, { status: 'todo' })
    await updateTask(TASK_ID, PROJECT_ID, { name: 'renamed' })
    expect(setCalls).toHaveLength(3)
    for (const patch of setCalls) expect('startedAt' in patch).toBe(false)
    expect(setCalls[0].completedAt).toBeInstanceOf(Date)
    expect(setCalls[1].completedAt).toBeNull()
  })
})

describe('reorderTasks', () => {
  it('applies the same rule per moved card inside the transaction', async () => {
    await reorderTasks(PROJECT_ID, [
      { id: 'a', orderIndex: 0, status: 'in-progress', columnId: 'col' },
      { id: 'b', orderIndex: 1, status: 'done' },
      { id: 'c', orderIndex: 2 },
    ])
    expect(setCalls).toHaveLength(3)
    expect(renderedStartedAt(setCalls[0])).toContain('coalesce')
    expect('startedAt' in setCalls[1]).toBe(false)
    expect('startedAt' in setCalls[2]).toBe(false)
  })
})

describe('createTask', () => {
  it('records the actual start on a card born in-progress and leaves it null otherwise', async () => {
    const base = { name: 'x', priority: 'medium' as const, color: 'purple', onTimeline: false, orderIndex: 0 }
    await createTask(PROJECT_ID, { ...base, status: 'in-progress' })
    await createTask(PROJECT_ID, { ...base, status: 'todo' })
    expect(insertValues).toHaveLength(2)
    expect(insertValues[0].startedAt).toBeInstanceOf(Date)
    expect(insertValues[1].startedAt).toBeNull()
  })
})

describe('createTasksBatch', () => {
  it('stamps the actual start on the in-progress row of a batch and leaves the todo row null', async () => {
    await createTasksBatch(PROJECT_ID, [
      { name: 'started', status: 'in-progress' },
      { name: 'waiting', status: 'todo' },
      { name: 'unspecified' },
    ])
    expect(insertValues).toHaveLength(1)
    const rows = insertValues[0] as unknown as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows[0].startedAt).toBeInstanceOf(Date)
    expect(rows[1].startedAt).toBeNull()
    expect(rows[2].startedAt).toBeNull()
    expect(rows.map((r) => r.orderIndex)).toEqual([5, 6, 7])
  })
})

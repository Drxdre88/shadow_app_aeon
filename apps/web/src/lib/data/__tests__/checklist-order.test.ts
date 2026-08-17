import { describe, it, expect, beforeEach, vi } from 'vitest'

// Legacy rows carry duplicate order_index values within a task, and Postgres
// returns ties in unstable order — checklist items (and the group headers
// derived from them) reshuffle between reads. Every checklist read must sort by
// (orderIndex, createdAt, id) so the tie is broken deterministically.

type QueryCapture = {
  selection: Record<string, unknown>
  orderBy: unknown[]
}

const selectQueue: unknown[][] = []
const queryCaptures: QueryCapture[] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[], capture: QueryCapture) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = pass
    chain.leftJoin = pass
    chain.where = pass
    chain.orderBy = (...args: unknown[]) => {
      capture.orderBy = args
      return chain
    }
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
    return chain
  }

  return {
    db: {
      select: vi.fn((selection: Record<string, unknown>) => {
        const capture: QueryCapture = { selection, orderBy: [] }
        queryCaptures.push(capture)
        return makeChain(selectQueue.shift() ?? [], capture)
      }),
    },
  }
})

vi.mock('../bridge', () => ({
  syncChecklistToGanttProgress: vi.fn(),
}))

import { checklistItems } from '@/lib/db/schema'
import {
  findChecklistItems,
  findChecklistItemsBatch,
  findChecklistSummariesAndPreviews,
} from '../checklist'

const TASK_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'

function lastQuery() {
  const query = queryCaptures.at(-1)
  if (!query) throw new Error('Expected a captured query')
  return query
}

function expectStableOrder(query: QueryCapture) {
  expect(query.orderBy).toEqual([
    checklistItems.orderIndex,
    checklistItems.createdAt,
    checklistItems.id,
  ])
  expect(query.orderBy.map((column) => (column as { name: string }).name)).toEqual([
    'order_index',
    'created_at',
    'id',
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  queryCaptures.length = 0
})

describe('findChecklistItems', () => {
  it('orders by orderIndex then createdAt then id', async () => {
    selectQueue.push([])

    await findChecklistItems(TASK_ID, PROJECT_ID)

    expectStableOrder(lastQuery())
  })
})

describe('findChecklistItemsBatch', () => {
  it('orders by orderIndex then createdAt then id', async () => {
    selectQueue.push([])

    await findChecklistItemsBatch([TASK_ID])

    expectStableOrder(lastQuery())
  })

  it('groups rows per task in the order the query returned them', async () => {
    selectQueue.push([
      { taskId: TASK_ID, title: 'first', groupName: 'Checklist' },
      { taskId: TASK_ID, title: 'second', groupName: 'Checklist' },
    ])

    const result = await findChecklistItemsBatch([TASK_ID])

    expect(result.get(TASK_ID)).toEqual([
      { title: 'first', groupName: 'Checklist' },
      { title: 'second', groupName: 'Checklist' },
    ])
  })

  it('short-circuits without querying when no task ids are given', async () => {
    const result = await findChecklistItemsBatch([])

    expect(result.size).toBe(0)
    expect(queryCaptures).toHaveLength(0)
  })
})

describe('findChecklistSummariesAndPreviews', () => {
  it('orders by orderIndex then createdAt then id', async () => {
    selectQueue.push([])

    await findChecklistSummariesAndPreviews(PROJECT_ID)

    expectStableOrder(lastQuery())
  })

  it('builds previews in the returned row order', async () => {
    selectQueue.push([
      { taskId: TASK_ID, title: 'first', state: 'checked', groupName: 'Checklist' },
      { taskId: TASK_ID, title: 'second', state: 'crossed', groupName: 'Checklist' },
      { taskId: TASK_ID, title: 'third', state: 'unchecked', groupName: 'Later' },
    ])

    const { summaries, previews } = await findChecklistSummariesAndPreviews(PROJECT_ID)

    expect(summaries[TASK_ID]).toEqual({ checked: 1, crossed: 1, total: 3 })
    expect(previews[TASK_ID].map((item) => item.title)).toEqual(['first', 'second', 'third'])
  })
})

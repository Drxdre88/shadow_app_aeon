import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

// A view is a re-grouping of the same board, so one card legitimately owns one
// bar PER VIEW. These tests pin both halves of that: re-running the push over
// the same view is a no-op (no duplicate bars for a retried action), while a
// second view over the same board gets its own full set of bars.
//
// The skip set is read from the bars sitting in the view's own lanes. Judging
// it from `boardTasks.ganttTaskId` — which is view-agnostic and can only ever
// name one bar — is what made every view after the first come up empty.

const state = vi.hoisted(() => ({
  harness: null as unknown as ReturnType<typeof import('./helpers/fake-db').createFakeDb>,
}))

vi.mock('@/lib/db', () => ({
  db: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => (state.harness.db as unknown as Record<string, unknown>)[prop],
  }),
}))

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import { bulkPushAllTasksToGantt, generateRowsForView } from '../bridge'
import { resetGanttProjectData } from '../ganttViews'
import { touchProject } from '../projects'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const COLUMN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CARD_A = '11111111-1111-4111-8111-111111111111'
const CARD_B = '22222222-2222-4222-8222-222222222222'
const CARD_C = '33333333-3333-4333-8333-333333333333'

const VIEW_B = '99999999-9999-4999-8999-999999999999'
const ROW_B = '88888888-8888-4888-8888-888888888888'

const VIEW_ROWS = [{ id: ROW_ID, name: 'Backlog' }]
const VIEW_B_ROWS = [{ id: ROW_B, name: 'Backlog' }]

const LANES = [
  { id: ROW_ID, projectId: PROJECT_ID, ganttViewId: VIEW_ID, name: 'Backlog', color: 'purple', orderIndex: 0 },
  { id: ROW_B, projectId: PROJECT_ID, ganttViewId: VIEW_B, name: 'Backlog', color: 'purple', orderIndex: 0 },
]

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: CARD_A,
  projectId: PROJECT_ID,
  columnId: COLUMN_ID,
  name: 'Card',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  size: null as number | null,
  orderIndex: 0,
  onTimeline: false,
  ganttTaskId: null as string | null,
  startDate: null as Date | null,
  endDate: null as Date | null,
  ...overrides,
})

function use(cards: Record<string, unknown>[], bars: Record<string, unknown>[] = []) {
  state.harness = createFakeDb({
    board_tasks: cards,
    gantt_tasks: bars,
    rows: LANES.map((l) => ({ ...l })),
    board_columns: [{ id: COLUMN_ID, projectId: PROJECT_ID, name: 'Backlog', orderIndex: 0 }],
  })
  return state.harness
}

const push = () =>
  bulkPushAllTasksToGantt(PROJECT_ID, VIEW_ID, VIEW_ROWS, 'column', 'column', false, false)

const pushToViewB = () =>
  bulkPushAllTasksToGantt(PROJECT_ID, VIEW_B, VIEW_B_ROWS, 'column', 'column', false, false)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('bulkPushAllTasksToGantt', () => {
  it('creates one bar per card on the first run', async () => {
    const h = use([makeCard({ id: CARD_A }), makeCard({ id: CARD_B })])

    const created = await push()

    expect(created).toHaveLength(2)
    expect(h.rows('gantt_tasks')).toHaveLength(2)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:updated' })
  })

  it('running it twice leaves the same number of bars', async () => {
    const h = use([makeCard({ id: CARD_A }), makeCard({ id: CARD_B })])

    await push()
    const barsAfterFirst = h.rows('gantt_tasks').map((b) => b.id)

    h.reset()
    const second = await push()

    expect(second).toEqual([])
    expect(h.rows('gantt_tasks').map((b) => b.id)).toEqual(barsAfterFirst)
    expect(h.statements.filter((s) => s.kind === 'insert')).toHaveLength(0)
  })

  it('skips a card whose link points at an existing bar', async () => {
    const h = use(
      [makeCard({ id: CARD_A, onTimeline: true, ganttTaskId: 'bar-a' })],
      [{ id: 'bar-a', projectId: PROJECT_ID, rowId: ROW_ID, boardTaskId: CARD_A }]
    )

    const created = await push()

    expect(created).toEqual([])
    expect(h.rows('gantt_tasks')).toHaveLength(1)
  })

  it('skips a card whose bar exists even after the card link was nulled', async () => {
    const h = use(
      [makeCard({ id: CARD_A, onTimeline: true, ganttTaskId: null })],
      [{ id: 'bar-a', projectId: PROJECT_ID, rowId: ROW_ID, boardTaskId: CARD_A }]
    )

    const created = await push()

    expect(created).toEqual([])
    expect(h.rows('gantt_tasks')).toHaveLength(1)
  })

  // Corrected: the old version asserted that a card pointing anywhere at all
  // was already scheduled. `ganttTaskId` names at most one bar out of N views,
  // so it cannot answer "is this card in THIS view" — here it names a bar this
  // project does not even own, and the view still owes the card a bar.
  it('schedules a card whose pointer names no bar in this view', async () => {
    const h = use([makeCard({ id: CARD_A, onTimeline: true, ganttTaskId: 'bar-elsewhere' })], [])

    const created = await push()

    expect(created).toHaveLength(1)
    expect(h.rows('gantt_tasks').map((b) => b.rowId)).toEqual([ROW_ID])
  })

  it('leaves the card pointing at the bar it already had', async () => {
    const h = use(
      [makeCard({ id: CARD_A, onTimeline: true, ganttTaskId: 'bar-in-view-a' })],
      [{ id: 'bar-in-view-a', projectId: PROJECT_ID, rowId: ROW_ID, boardTaskId: CARD_A }]
    )

    await pushToViewB()

    const card = h.rows('board_tasks')[0]
    expect(card.ganttTaskId).toBe('bar-in-view-a')
    expect(card.onTimeline).toBe(true)
  })

  it('still schedules a card added after the first run', async () => {
    const h = use([makeCard({ id: CARD_A }), makeCard({ id: CARD_B })])

    await push()
    h.rows('board_tasks').push(makeCard({ id: CARD_C }))
    h.reset()

    const created = await push()

    expect(created).toHaveLength(1)
    expect(created[0].boardTaskId).toBe(CARD_C)
    expect(h.rows('gantt_tasks')).toHaveLength(3)
  })

  it('does not publish a board event when nothing was scheduled', async () => {
    const h = use([makeCard({ id: CARD_A })])

    await push()
    vi.clearAllMocks()
    h.reset()
    await push()

    expect(touchProject).not.toHaveBeenCalled()
  })

  it('inserts the bars and links the cards inside one transaction', async () => {
    const h = use([makeCard({ id: CARD_A })])
    const transaction = vi.spyOn(h.db, 'transaction')

    await push()

    expect(transaction).toHaveBeenCalledTimes(1)
    const inside = h.statements.filter(
      (s) => (s.kind === 'insert' && s.table === 'gantt_tasks') || (s.kind === 'update' && s.table === 'board_tasks')
    )
    expect(inside).toHaveLength(2)
  })

  it('ignores done cards', async () => {
    const h = use([makeCard({ id: CARD_A, status: 'done' }), makeCard({ id: CARD_B })])

    const created = await push()

    expect(created).toHaveLength(1)
    expect(created[0].boardTaskId).toBe(CARD_B)
    expect(h.rows('gantt_tasks')).toHaveLength(1)
  })
})

describe('bulkPushAllTasksToGantt across views', () => {
  it('gives a second view over the same board its own bars', async () => {
    const h = use([makeCard({ id: CARD_A }), makeCard({ id: CARD_B })])

    await push()
    const second = await pushToViewB()

    expect(second).toHaveLength(2)
    expect(h.rows('gantt_tasks').filter((b) => b.rowId === ROW_ID)).toHaveLength(2)
    expect(h.rows('gantt_tasks').filter((b) => b.rowId === ROW_B)).toHaveLength(2)
  })

  it('is still idempotent within the second view', async () => {
    const h = use([makeCard({ id: CARD_A })])

    await push()
    await pushToViewB()
    h.reset()
    const again = await pushToViewB()

    expect(again).toEqual([])
    expect(h.rows('gantt_tasks')).toHaveLength(2)
  })

  it('fills a fresh view after a reset left the old view standing', async () => {
    const h = use([makeCard({ id: CARD_A }), makeCard({ id: CARD_B })])
    await push()

    await resetGanttProjectData(PROJECT_ID)
    expect(h.rows('board_tasks').every((c) => c.ganttTaskId === null)).toBe(true)

    const created = await pushToViewB()

    expect(created).toHaveLength(2)
    expect(h.rows('gantt_tasks').filter((b) => b.rowId === ROW_B)).toHaveLength(2)
  })

  it('reads the cards inside the transaction it writes them in', async () => {
    const h = use([makeCard({ id: CARD_A })])
    const seen: string[] = []
    const original = h.db.transaction.bind(h.db)
    h.db.transaction = ((cb: (tx: unknown) => Promise<unknown>) => {
      const before = h.statements.length
      return original(cb as never).then((result: unknown) => {
        for (const s of h.statements.slice(before)) seen.push(`${s.kind}:${s.table}`)
        return result
      })
    }) as typeof h.db.transaction

    await push()

    expect(seen).toContain('select:board_tasks')
    expect(seen).toContain('select:gantt_tasks')
    expect(seen).toContain('insert:gantt_tasks')
    expect(seen).toContain('update:board_tasks')
  })
})

describe('generateRowsForView', () => {
  function useColumns() {
    state.harness = createFakeDb({
      board_columns: [
        { id: COLUMN_ID, projectId: PROJECT_ID, name: 'Backlog', color: 'purple', orderIndex: 0 },
        { id: 'col-done', projectId: PROJECT_ID, name: 'Done', color: 'green', orderIndex: 1 },
      ],
      rows: [],
    })
    return state.harness
  }

  it('creates one lane per column', async () => {
    const h = useColumns()

    const generated = await generateRowsForView(PROJECT_ID, VIEW_ID, 'column')

    expect(generated.map((r) => r.name)).toEqual(['Backlog', 'Done'])
    expect(h.rows('rows')).toHaveLength(2)
  })

  it('prunes excluded sections in the same transaction as the insert', async () => {
    const h = useColumns()
    const transaction = vi.spyOn(h.db, 'transaction')

    const generated = await generateRowsForView(PROJECT_ID, VIEW_ID, 'column', ['Done'])

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(generated.map((r) => r.name)).toEqual(['Backlog'])
    expect(h.rows('rows').map((r) => r.name)).toEqual(['Backlog'])
  })
})

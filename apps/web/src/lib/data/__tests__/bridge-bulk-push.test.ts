import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

// A card owns at most one bar: `boardTasks.ganttTaskId` is a single column, so
// a second bar for the same card leaves the first alive but unreachable from
// the board. The bulk push used to mint exactly that on every re-run — a
// retried action, or a second view over the same board. These tests pin that
// re-running is a no-op, from either half of the link.

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
import { touchProject } from '../projects'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const COLUMN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CARD_A = '11111111-1111-4111-8111-111111111111'
const CARD_B = '22222222-2222-4222-8222-222222222222'
const CARD_C = '33333333-3333-4333-8333-333333333333'

const VIEW_ROWS = [{ id: ROW_ID, name: 'Backlog' }]

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
    board_columns: [{ id: COLUMN_ID, projectId: PROJECT_ID, name: 'Backlog', orderIndex: 0 }],
  })
  return state.harness
}

const push = () =>
  bulkPushAllTasksToGantt(PROJECT_ID, VIEW_ID, VIEW_ROWS, 'column', 'column', false, false)

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

  it('skips a card that claims a bar in another project rather than forking one', async () => {
    const h = use([makeCard({ id: CARD_A, onTimeline: true, ganttTaskId: 'bar-elsewhere' })], [])

    const created = await push()

    expect(created).toEqual([])
    expect(h.rows('gantt_tasks')).toHaveLength(0)
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

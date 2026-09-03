import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

// "Add to timeline" targets ONE view. The lookup for an existing bar used to be
// view-agnostic, so a card already on view A got view A's bar handed back when
// the user pushed it onto view B: the client rendered into a row view B does
// not own (nothing appeared), and the card's dates were replaced by view A's
// schedule. These tests pin the (card, view) scoping and the link ownership
// that goes with it.

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

import { pushTaskToGantt } from '../bridge'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VIEW_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VIEW_B = '99999999-9999-4999-8999-999999999999'
const ROW_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ROW_A2 = '77777777-7777-4777-8777-777777777777'
const ROW_B = '88888888-8888-4888-8888-888888888888'
const BAR_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NEW_BAR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const CARD = '11111111-1111-4111-8111-111111111111'

const CARD_START = new Date('2026-03-02T00:00:00.000Z')
const CARD_END = new Date('2026-03-06T00:00:00.000Z')
const BAR_A_START = new Date('2026-09-01T00:00:00.000Z')
const BAR_A_END = new Date('2026-09-04T00:00:00.000Z')

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: CARD,
  projectId: PROJECT_ID,
  name: 'Card',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  size: null as number | null,
  onTimeline: false,
  ganttTaskId: null as string | null,
  startDate: CARD_START as Date | null,
  endDate: CARD_END as Date | null,
  ...overrides,
})

const LANES = [
  { id: ROW_A, projectId: PROJECT_ID, ganttViewId: VIEW_A, name: 'Backlog', orderIndex: 0 },
  { id: ROW_A2, projectId: PROJECT_ID, ganttViewId: VIEW_A, name: 'Doing', orderIndex: 1 },
  { id: ROW_B, projectId: PROJECT_ID, ganttViewId: VIEW_B, name: 'Backlog', orderIndex: 0 },
]

function use(cards: Record<string, unknown>[], bars: Record<string, unknown>[] = []) {
  state.harness = createFakeDb({
    board_tasks: cards,
    gantt_tasks: bars,
    rows: LANES.map((l) => ({ ...l })),
  })
  return state.harness
}

const barInViewA = (overrides: Record<string, unknown> = {}) => ({
  id: BAR_A,
  projectId: PROJECT_ID,
  rowId: ROW_A,
  boardTaskId: CARD,
  name: 'Card',
  startDate: BAR_A_START,
  endDate: BAR_A_END,
  color: 'purple',
  progress: 0,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pushTaskToGantt', () => {
  it('creates a bar in the view it was asked for', async () => {
    const h = use([makeCard()])

    const bar = await pushTaskToGantt(CARD, PROJECT_ID, VIEW_A, ROW_A, NEW_BAR)

    expect(bar.rowId).toBe(ROW_A)
    expect(h.rows('gantt_tasks')).toHaveLength(1)
    const card = h.rows('board_tasks')[0]
    expect(card.ganttTaskId).toBe(NEW_BAR)
    expect(card.onTimeline).toBe(true)
  })

  it('creates a bar in view B when the card already has one in view A', async () => {
    const h = use(
      [makeCard({ onTimeline: true, ganttTaskId: BAR_A })],
      [barInViewA()]
    )

    const bar = await pushTaskToGantt(CARD, PROJECT_ID, VIEW_B, ROW_B, NEW_BAR)

    expect(bar.id).toBe(NEW_BAR)
    expect(bar.rowId).toBe(ROW_B)
    expect(h.rows('gantt_tasks').map((b) => b.rowId).sort()).toEqual([ROW_A, ROW_B].sort())
  })

  it('leaves view A undisturbed when pushing to view B', async () => {
    const h = use(
      [makeCard({ onTimeline: true, ganttTaskId: BAR_A })],
      [barInViewA()]
    )

    await pushTaskToGantt(CARD, PROJECT_ID, VIEW_B, ROW_B, NEW_BAR)

    const viewABar = h.rows('gantt_tasks').find((b) => b.id === BAR_A)!
    expect(viewABar.rowId).toBe(ROW_A)
    expect(viewABar.startDate).toBe(BAR_A_START)
    const card = h.rows('board_tasks')[0]
    expect(card.ganttTaskId).toBe(BAR_A)
  })

  it('keeps the card dates the user typed instead of adopting the other view\'s', async () => {
    const h = use(
      [makeCard({ onTimeline: true, ganttTaskId: BAR_A })],
      [barInViewA()]
    )

    await pushTaskToGantt(CARD, PROJECT_ID, VIEW_B, ROW_B, NEW_BAR)

    const card = h.rows('board_tasks')[0]
    expect(card.startDate).toBe(CARD_START)
    expect(card.endDate).toBe(CARD_END)
  })

  it('re-links a drifted card to the bar still standing in this view', async () => {
    const h = use(
      [makeCard({ onTimeline: false, ganttTaskId: null })],
      [barInViewA()]
    )

    const bar = await pushTaskToGantt(CARD, PROJECT_ID, VIEW_A, ROW_A, NEW_BAR)

    expect(bar.id).toBe(BAR_A)
    expect(h.rows('gantt_tasks')).toHaveLength(1)
    const card = h.rows('board_tasks')[0]
    expect(card.ganttTaskId).toBe(BAR_A)
    expect(card.onTimeline).toBe(true)
  })

  it('moves the re-linked bar to the lane it was pushed onto', async () => {
    const h = use([makeCard()], [barInViewA()])

    const bar = await pushTaskToGantt(CARD, PROJECT_ID, VIEW_A, ROW_A2, NEW_BAR)

    expect(bar.id).toBe(BAR_A)
    expect(bar.rowId).toBe(ROW_A2)
    expect(h.rows('gantt_tasks')[0].rowId).toBe(ROW_A2)
  })

  it('rejects a lane that belongs to a different view', async () => {
    use([makeCard()])

    await expect(pushTaskToGantt(CARD, PROJECT_ID, VIEW_B, ROW_A, NEW_BAR)).rejects.toThrow(
      'Row does not belong to this Gantt view'
    )
  })

  it('rejects a card from another project', async () => {
    use([makeCard({ projectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })])

    await expect(pushTaskToGantt(CARD, PROJECT_ID, VIEW_A, ROW_A, NEW_BAR)).rejects.toThrow(
      'Board task not found'
    )
  })

  it('reads the card and its bars inside the transaction it writes in', async () => {
    const h = use([makeCard()])
    const seen: string[] = []
    const original = h.db.transaction.bind(h.db)
    h.db.transaction = ((cb: (tx: unknown) => Promise<unknown>) => {
      const before = h.statements.length
      return original(cb as never).then((result: unknown) => {
        for (const s of h.statements.slice(before)) seen.push(`${s.kind}:${s.table}`)
        return result
      })
    }) as typeof h.db.transaction

    await pushTaskToGantt(CARD, PROJECT_ID, VIEW_A, ROW_A, NEW_BAR)

    expect(seen).toEqual([
      'select:board_tasks',
      'select:rows',
      'select:gantt_tasks',
      'insert:gantt_tasks',
      'update:board_tasks',
    ])
  })
})

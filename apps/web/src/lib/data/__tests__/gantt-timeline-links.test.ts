import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, type Statement } from './helpers/fake-db'

// The board <-> timeline link has two halves: `boardTasks.onTimeline` +
// `boardTasks.ganttTaskId` on the card, and the `gantt_tasks` bar itself.
// Every test here pins a case where the halves used to drift apart and take
// user data with them — a project-wide date wipe on reset, and cards left
// flagged "on the timeline" after their bar was deleted.
//
// These run against the in-memory fake in ./helpers/fake-db, which renders the
// real Drizzle WHERE for each statement and evaluates it against JS rows. A row
// survives here only if the SQL the production code emits would spare it.

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

import { deleteGanttTask, deleteRow } from '../gantt'
import { resetGanttProjectData, deleteGanttView } from '../ganttViews'
import { touchProject } from '../projects'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_PROJECT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const VIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BAR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SCHEDULED_CARD = '11111111-1111-4111-8111-111111111111'
const MANUAL_CARD = '22222222-2222-4222-8222-222222222222'
const DRIFTED_CARD = '33333333-3333-4333-8333-333333333333'

const HAND_TYPED_START = new Date('2026-03-02T00:00:00.000Z')
const HAND_TYPED_END = new Date('2026-03-06T00:00:00.000Z')

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: SCHEDULED_CARD,
  projectId: PROJECT_ID,
  name: 'Card',
  status: 'todo',
  onTimeline: false,
  ganttTaskId: null as string | null,
  startDate: null as Date | null,
  endDate: null as Date | null,
  ...overrides,
})

const makeBar = (overrides: Record<string, unknown> = {}) => ({
  id: BAR_ID,
  projectId: PROJECT_ID,
  rowId: ROW_ID,
  boardTaskId: SCHEDULED_CARD,
  name: 'Card',
  startDate: HAND_TYPED_START,
  endDate: HAND_TYPED_END,
  ...overrides,
})

function use(seed: Record<string, Record<string, unknown>[]>) {
  state.harness = createFakeDb(seed)
  return state.harness
}

const cardsTouchedBy = (statements: Statement[]) =>
  statements.filter((s) => s.kind === 'update' && s.table === 'board_tasks')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resetGanttProjectData', () => {
  it('leaves a card that was never on a timeline completely untouched', async () => {
    const h = use({
      board_tasks: [
        makeCard({ id: SCHEDULED_CARD, onTimeline: true, ganttTaskId: BAR_ID, startDate: HAND_TYPED_START, endDate: HAND_TYPED_END }),
        makeCard({ id: MANUAL_CARD, startDate: HAND_TYPED_START, endDate: HAND_TYPED_END }),
      ],
      gantt_tasks: [makeBar({ rowId: null })],
      rows: [],
    })

    await resetGanttProjectData(PROJECT_ID)

    const manual = h.rows('board_tasks').find((c) => c.id === MANUAL_CARD)!
    expect(manual.startDate).toBe(HAND_TYPED_START)
    expect(manual.endDate).toBe(HAND_TYPED_END)
    expect(manual.onTimeline).toBe(false)

    const scheduled = h.rows('board_tasks').find((c) => c.id === SCHEDULED_CARD)!
    expect(scheduled.startDate).toBeNull()
    expect(scheduled.endDate).toBeNull()
    expect(scheduled.onTimeline).toBe(false)
    expect(scheduled.ganttTaskId).toBeNull()
  })

  it('clears a card whose bar is gone but whose flag is still set', async () => {
    const h = use({
      board_tasks: [makeCard({ id: DRIFTED_CARD, onTimeline: true, ganttTaskId: null, startDate: HAND_TYPED_START })],
      gantt_tasks: [],
      rows: [],
    })

    await resetGanttProjectData(PROJECT_ID)

    const drifted = h.rows('board_tasks')[0]
    expect(drifted.onTimeline).toBe(false)
    expect(drifted.startDate).toBeNull()
  })

  it('issues no card update at all when nothing is on a timeline', async () => {
    const h = use({
      board_tasks: [makeCard({ id: MANUAL_CARD, startDate: HAND_TYPED_START, endDate: HAND_TYPED_END })],
      gantt_tasks: [],
      rows: [],
    })

    await resetGanttProjectData(PROJECT_ID)

    expect(cardsTouchedBy(h.statements)).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('cannot reach another project', async () => {
    const h = use({
      board_tasks: [
        makeCard({ id: SCHEDULED_CARD, onTimeline: true, ganttTaskId: BAR_ID, startDate: HAND_TYPED_START }),
        makeCard({ id: MANUAL_CARD, projectId: OTHER_PROJECT_ID, onTimeline: true, startDate: HAND_TYPED_START }),
      ],
      gantt_tasks: [],
      rows: [],
    })

    await resetGanttProjectData(PROJECT_ID)

    const foreign = h.rows('board_tasks').find((c) => c.id === MANUAL_CARD)!
    expect(foreign.onTimeline).toBe(true)
    expect(foreign.startDate).toBe(HAND_TYPED_START)
  })

  it('publishes a board event once cards were cleared', async () => {
    use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID })],
      gantt_tasks: [],
      rows: [],
    })

    await resetGanttProjectData(PROJECT_ID)

    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:updated' })
  })
})

describe('deleteGanttTask', () => {
  it('leaves no card flagged for a bar that no longer exists', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID, startDate: HAND_TYPED_START, endDate: HAND_TYPED_END })],
      gantt_tasks: [makeBar()],
    })

    const deleted = await deleteGanttTask(BAR_ID, PROJECT_ID)

    expect(deleted).toBe(true)
    expect(h.rows('gantt_tasks')).toHaveLength(0)
    const card = h.rows('board_tasks')[0]
    expect(card.onTimeline).toBe(false)
    expect(card.ganttTaskId).toBeNull()
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:updated' })
  })

  it('keeps the card dates, which are the user data half', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID, startDate: HAND_TYPED_START, endDate: HAND_TYPED_END })],
      gantt_tasks: [makeBar()],
    })

    await deleteGanttTask(BAR_ID, PROJECT_ID)

    const card = h.rows('board_tasks')[0]
    expect(card.startDate).toBe(HAND_TYPED_START)
    expect(card.endDate).toBe(HAND_TYPED_END)
  })

  it('unflags the card before the bar row is removed', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID })],
      gantt_tasks: [makeBar()],
    })

    await deleteGanttTask(BAR_ID, PROJECT_ID)

    const cardUpdate = h.statements.findIndex((s) => s.kind === 'update' && s.table === 'board_tasks')
    const barDelete = h.statements.findIndex((s) => s.kind === 'delete' && s.table === 'gantt_tasks')
    expect(cardUpdate).toBeGreaterThanOrEqual(0)
    expect(cardUpdate).toBeLessThan(barDelete)
  })

  it('clears a card that points at the bar even when the bar lost its back-link', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID })],
      gantt_tasks: [makeBar({ boardTaskId: null })],
    })

    await deleteGanttTask(BAR_ID, PROJECT_ID)

    expect(h.rows('board_tasks')[0].onTimeline).toBe(false)
    expect(h.rows('board_tasks')[0].ganttTaskId).toBeNull()
  })

  it('does not touch cards belonging to other bars', async () => {
    const otherBar = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const h = use({
      board_tasks: [
        makeCard({ id: SCHEDULED_CARD, onTimeline: true, ganttTaskId: BAR_ID }),
        makeCard({ id: MANUAL_CARD, onTimeline: true, ganttTaskId: otherBar }),
      ],
      gantt_tasks: [makeBar(), makeBar({ id: otherBar, boardTaskId: MANUAL_CARD })],
    })

    await deleteGanttTask(BAR_ID, PROJECT_ID)

    const survivor = h.rows('board_tasks').find((c) => c.id === MANUAL_CARD)!
    expect(survivor.onTimeline).toBe(true)
    expect(survivor.ganttTaskId).toBe(otherBar)
    expect(h.rows('gantt_tasks')).toHaveLength(1)
  })

  it('skips the board event when the bar was not in this project', async () => {
    use({
      board_tasks: [],
      gantt_tasks: [makeBar({ projectId: OTHER_PROJECT_ID })],
    })

    const deleted = await deleteGanttTask(BAR_ID, PROJECT_ID)

    expect(deleted).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('deleteRow', () => {
  it('takes the lane bars with it and unflags their cards', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID })],
      gantt_tasks: [makeBar()],
      rows: [{ id: ROW_ID, projectId: PROJECT_ID, ganttViewId: VIEW_ID, name: 'Lane', orderIndex: 0 }],
    })

    const deleted = await deleteRow(ROW_ID, PROJECT_ID)

    expect(deleted).toBe(true)
    expect(h.rows('gantt_tasks')).toHaveLength(0)
    expect(h.rows('board_tasks')[0].onTimeline).toBe(false)
    expect(h.rows('board_tasks')[0].ganttTaskId).toBeNull()
  })
})

describe('deleteGanttView', () => {
  it('takes the view bars with it and unflags their cards', async () => {
    const h = use({
      board_tasks: [makeCard({ onTimeline: true, ganttTaskId: BAR_ID, startDate: HAND_TYPED_START })],
      gantt_tasks: [makeBar()],
      rows: [{ id: ROW_ID, projectId: PROJECT_ID, ganttViewId: VIEW_ID, name: 'Lane', orderIndex: 0 }],
      gantt_views: [{ id: VIEW_ID, projectId: PROJECT_ID, name: 'Timeline', groupBy: 'column', filters: {} }],
    })

    const deleted = await deleteGanttView(VIEW_ID, PROJECT_ID)

    expect(deleted).toBe(true)
    expect(h.rows('gantt_tasks')).toHaveLength(0)
    expect(h.rows('gantt_views')).toHaveLength(0)
    const card = h.rows('board_tasks')[0]
    expect(card.onTimeline).toBe(false)
    expect(card.ganttTaskId).toBeNull()
    expect(card.startDate).toBe(HAND_TYPED_START)
  })

  it('leaves bars from another view alone', async () => {
    const otherView = '44444444-4444-4444-8444-444444444444'
    const otherRow = '55555555-5555-4555-8555-555555555555'
    const otherBar = '66666666-6666-4666-8666-666666666666'
    const h = use({
      board_tasks: [
        makeCard({ id: SCHEDULED_CARD, onTimeline: true, ganttTaskId: BAR_ID }),
        makeCard({ id: MANUAL_CARD, onTimeline: true, ganttTaskId: otherBar }),
      ],
      gantt_tasks: [makeBar(), makeBar({ id: otherBar, rowId: otherRow, boardTaskId: MANUAL_CARD })],
      rows: [
        { id: ROW_ID, projectId: PROJECT_ID, ganttViewId: VIEW_ID, name: 'Lane', orderIndex: 0 },
        { id: otherRow, projectId: PROJECT_ID, ganttViewId: otherView, name: 'Other lane', orderIndex: 0 },
      ],
      gantt_views: [
        { id: VIEW_ID, projectId: PROJECT_ID, name: 'Timeline', groupBy: 'column', filters: {} },
        { id: otherView, projectId: PROJECT_ID, name: 'Other', groupBy: 'column', filters: {} },
      ],
    })

    await deleteGanttView(VIEW_ID, PROJECT_ID)

    expect(h.rows('gantt_tasks').map((b) => b.id)).toEqual([otherBar])
    const survivor = h.rows('board_tasks').find((c) => c.id === MANUAL_CARD)!
    expect(survivor.onTimeline).toBe(true)
  })
})

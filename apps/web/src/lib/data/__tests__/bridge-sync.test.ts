import { describe, it, expect, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

// Dragging a bar re-dates its card. The card's new version has to come back to
// the client, and the write must stay inside the project the caller holds.

const state = vi.hoisted(() => ({
  harness: null as unknown as ReturnType<typeof import('./helpers/fake-db').createFakeDb>,
}))

vi.mock('@/lib/db', () => ({
  db: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => (state.harness.db as unknown as Record<string, unknown>)[prop],
  }),
}))

import { syncGanttDatesToBoard } from '../bridge'

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BAR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CARD = '11111111-1111-4111-8111-111111111111'
const START = new Date('2026-10-01T00:00:00.000Z')
const END = new Date('2026-10-03T00:00:00.000Z')

function use(barProject = PROJECT, boardTaskId: string | null = CARD) {
  state.harness = createFakeDb({
    board_tasks: [{ id: CARD, projectId: barProject, startDate: null, endDate: null, updatedAt: new Date('2026-01-01T00:00:00.000Z') }],
    gantt_tasks: [{ id: BAR, projectId: barProject, boardTaskId }],
  })
  return state.harness
}

describe('syncGanttDatesToBoard', () => {
  it('re-dates the linked card and returns the version it stamped', async () => {
    const h = use()

    const stamp = await syncGanttDatesToBoard(BAR, PROJECT, START, END)

    const card = h.rows('board_tasks')[0]
    expect(card.startDate).toEqual(START)
    expect(card.endDate).toEqual(END)
    expect(stamp).toEqual({ boardTaskId: CARD, updatedAt: (card.updatedAt as Date).toISOString() })
  })

  it('returns null and writes nothing for a bar without a card', async () => {
    const h = use(PROJECT, null)

    expect(await syncGanttDatesToBoard(BAR, PROJECT, START, END)).toBeNull()
    expect(h.rows('board_tasks')[0].startDate).toBeNull()
  })

  it('does not touch a bar that belongs to another project', async () => {
    const h = use(OTHER)

    expect(await syncGanttDatesToBoard(BAR, PROJECT, START, END)).toBeNull()
    expect(h.rows('board_tasks')[0].startDate).toBeNull()
  })
})

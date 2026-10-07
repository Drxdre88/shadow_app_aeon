import { describe, it, expect, vi, beforeEach } from 'vitest'

// A bar drag re-dates its card. The action waits for that write, does it
// before the bar write (whose broadcast then carries the card's new version),
// and hands the card's version back so the client's next card drag is current.

const order: string[] = []

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({ requireEditor: vi.fn(), requireOwnership: vi.fn() }))
vi.mock('@/lib/data/gantt', () => ({
  findRows: vi.fn(),
  findGanttTasks: vi.fn(),
  createGanttTask: vi.fn(),
  updateGanttTask: vi.fn(async () => { order.push('bar'); return { id: 'bar-1', name: 'Bar' } }),
  deleteGanttTask: vi.fn(),
  createRow: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
}))
vi.mock('@/lib/data/bridge', () => ({ syncGanttDatesToBoard: vi.fn() }))

import { requireEditor } from '@/lib/actions/helpers'
import { updateGanttTask as _updateGanttTask } from '@/lib/data/gantt'
import { syncGanttDatesToBoard } from '@/lib/data/bridge'
import { updateGanttTask } from '../gantt'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const START = '2026-10-01T00:00:00.000Z'
const END = '2026-10-03T00:00:00.000Z'
const STAMP = { boardTaskId: 'card-1', updatedAt: '2026-10-07T06:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(syncGanttDatesToBoard).mockImplementation(async () => { order.push('card'); return STAMP })
})

describe('updateGanttTask', () => {
  it('re-dates the card first, scoped to the project, and returns its version', async () => {
    const result = await updateGanttTask('bar-1', PROJECT, { startDate: START, endDate: END })

    expect(syncGanttDatesToBoard).toHaveBeenCalledWith('bar-1', PROJECT, new Date(START), new Date(END))
    expect(order).toEqual(['card', 'bar'])
    expect(result).toEqual({ id: 'bar-1', name: 'Bar', boardTask: STAMP })
  })

  it('leaves the card alone when the update carries no date range', async () => {
    const result = await updateGanttTask('bar-1', PROJECT, { name: 'Renamed' })

    expect(syncGanttDatesToBoard).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'bar-1', name: 'Bar', boardTask: null })
  })

  it('still saves the bar when the card sync fails', async () => {
    vi.mocked(syncGanttDatesToBoard).mockRejectedValue(new Error('db down'))

    const result = await updateGanttTask('bar-1', PROJECT, { startDate: START, endDate: END })

    expect(_updateGanttTask).toHaveBeenCalled()
    expect(result).toEqual({ id: 'bar-1', name: 'Bar', boardTask: null })
  })
})

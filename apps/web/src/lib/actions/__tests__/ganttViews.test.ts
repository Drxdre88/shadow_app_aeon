import { describe, it, expect, vi, beforeEach } from 'vitest'

// restoreTimelineSnapshot is the undo of a timeline reset: a client-held
// snapshot comes back through the action, so the shape is validated before
// the guard runs and the data layer is called exactly once with the
// normalised entries.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/actions/helpers', () => ({
  requireEditor: vi.fn(),
  requireOwnership: vi.fn(),
}))

vi.mock('@/lib/data/ganttViews', () => ({
  findGanttViews: vi.fn(),
  createGanttView: vi.fn(),
  updateGanttView: vi.fn(),
  deleteGanttView: vi.fn(),
  reflowGanttViewRows: vi.fn(),
  resetGanttProjectData: vi.fn(),
  restoreTimelineSnapshot: vi.fn(),
}))

vi.mock('@/lib/data/bridge', () => ({
  generateRowsForView: vi.fn(),
  bulkPushAllTasksToGantt: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { requireEditor } from '@/lib/actions/helpers'
import { restoreTimelineSnapshot as _restoreTimelineSnapshot, type TimelineResetSnapshotEntry } from '@/lib/data/ganttViews'
import { TIMELINE_SNAPSHOT_MAX } from '@/lib/data/validators'
import { restoreTimelineSnapshot } from '../ganttViews'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const entry = (i: number, over: Partial<TimelineResetSnapshotEntry> = {}): TimelineResetSnapshotEntry => ({
  id: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
  startDate: null,
  endDate: null,
  onTimeline: true,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(_restoreTimelineSnapshot).mockResolvedValue(1)
})

describe('restoreTimelineSnapshot', () => {
  it('rejects a snapshot past the cap before the guard or the data layer run', async () => {
    const tooMany = Array.from({ length: TIMELINE_SNAPSHOT_MAX + 1 }, (_, i) => entry(i))
    await expect(restoreTimelineSnapshot(PROJECT, tooMany)).rejects.toThrow()
    expect(requireEditor).not.toHaveBeenCalled()
    expect(_restoreTimelineSnapshot).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects an unparseable date before the guard, so a bad string never reaches a ::timestamp cast', async () => {
    await expect(restoreTimelineSnapshot(PROJECT, [entry(0, { startDate: 'not a date' })])).rejects.toThrow(/Invalid ISO 8601/)
    expect(requireEditor).not.toHaveBeenCalled()
    expect(_restoreTimelineSnapshot).not.toHaveBeenCalled()
  })

  it('accepts a snapshot at the cap, guards, calls the data layer once and returns its count', async () => {
    const atCap = Array.from({ length: TIMELINE_SNAPSHOT_MAX }, (_, i) => entry(i))
    vi.mocked(_restoreTimelineSnapshot).mockResolvedValue(TIMELINE_SNAPSHOT_MAX - 3)

    await expect(restoreTimelineSnapshot(PROJECT, atCap)).resolves.toBe(TIMELINE_SNAPSHOT_MAX - 3)

    expect(requireEditor).toHaveBeenCalledWith(PROJECT)
    expect(_restoreTimelineSnapshot).toHaveBeenCalledTimes(1)
    const [projectId, entries] = vi.mocked(_restoreTimelineSnapshot).mock.calls[0]
    expect(projectId).toBe(PROJECT)
    expect(entries).toHaveLength(TIMELINE_SNAPSHOT_MAX)
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
  })

  it('hands the data layer UTC-normalised dates, keeping an offset that Date would otherwise drop', async () => {
    await restoreTimelineSnapshot(PROJECT, [entry(0, { id: A, startDate: '2026-09-01T10:00:00+05:00', endDate: '2026' })])
    const [, entries] = vi.mocked(_restoreTimelineSnapshot).mock.calls[0]
    expect(entries).toEqual([{ id: A, startDate: '2026-09-01T05:00:00.000Z', endDate: '2026-01-01T00:00:00.000Z', onTimeline: true }])
  })

  it('stops at the guard for a viewer, writing nothing', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(restoreTimelineSnapshot(PROJECT, [entry(0)])).rejects.toThrow('Viewers cannot modify')
    expect(_restoreTimelineSnapshot).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({ requireOwnership: vi.fn(), requireEditor: vi.fn().mockResolvedValue('user-1') }))
vi.mock('@/lib/data/tasks', () => ({
  findTasks: vi.fn().mockResolvedValue([]),
  findTaskById: vi.fn().mockResolvedValue(null),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  archiveTask: vi.fn(),
  restoreTask: vi.fn(),
  archiveTasksBatch: vi.fn(),
  findArchivedTasks: vi.fn(),
  findTaskVersions: vi.fn(),
}))
vi.mock('@/lib/data/columns', () => ({ findColumns: vi.fn(), createDefaultColumns: vi.fn() }))
vi.mock('@/lib/data/labels', () => ({ findLabels: vi.fn(), findTaskLabels: vi.fn(), setTaskLabels: vi.fn() }))
vi.mock('@/lib/data/dependencies', () => ({ findDependencies: vi.fn() }))
vi.mock('@/lib/data/checklist', () => ({ findChecklistSummariesAndPreviews: vi.fn(), findChecklistItems: vi.fn(), createChecklistItemsBatch: vi.fn() }))
vi.mock('@/lib/data/assignees', () => ({ getAssigneesForProject: vi.fn() }))
vi.mock('@/lib/data/member-profiles', () => ({ findRealmAvatarPrefs: vi.fn() }))
vi.mock('@/lib/data/virtual-members', () => ({ getVirtualAssigneesForProject: vi.fn(), findVirtualMembersForProject: vi.fn() }))
vi.mock('@/lib/data/bridge', () => ({ syncBoardStatusToGantt: vi.fn().mockResolvedValue(undefined), deleteLinkedGanttTask: vi.fn() }))
vi.mock('@/lib/data/activity', () => ({ emitActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/kairos/auto-capture', () => ({ captureBoardEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/data/storage', () => ({ checkStorageLimit: vi.fn() }))
vi.mock('@/lib/data/board-version', () => ({ findBoardVersion: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateTask, reorderTasks, findTaskVersions } from '@/lib/data/tasks'
import { updateBoardTask, reorderBoardTasks } from '@/lib/actions/board'

const P = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const T2 = '33333333-3333-4333-8333-333333333333'
const COL_A = '44444444-4444-4444-8444-444444444444'
const COL_B = '55555555-5555-4555-8555-555555555555'
const SEEN = '2026-10-06T10:00:00.123Z'

const row = (id: string, iso: string, columnId = COL_A) => ({ id, updatedAt: new Date(iso), columnId })

beforeEach(() => {
  vi.mocked(updateTask).mockReset().mockResolvedValue({ id: T1, name: 'Card', updatedAt: new Date('2026-10-06T10:05:00.000Z') } as never)
  vi.mocked(reorderTasks).mockReset().mockResolvedValue(new Date('2026-10-06T10:05:00.000Z'))
  vi.mocked(findTaskVersions).mockReset()
})

describe('updateBoardTask stale-move guard', () => {
  it('refuses a column move when the row changed after the client saw it, writing nothing', async () => {
    vi.mocked(findTaskVersions).mockResolvedValue([row(T1, '2026-10-06T10:00:00.124Z')])
    const result = await updateBoardTask(T1, P, { columnId: COL_B, expectedUpdatedAt: SEEN })
    expect(result).toEqual({ staleBoard: true, taskIds: [T1] })
    expect(updateTask).not.toHaveBeenCalled()
  })

  it.each([
    ['equal', SEEN],
    ['older', '2026-10-06T09:59:59.999Z'],
  ])('accepts the move when the row is %s', async (_label, stored) => {
    vi.mocked(findTaskVersions).mockResolvedValue([row(T1, stored)])
    const result = await updateBoardTask(T1, P, { columnId: COL_B, expectedUpdatedAt: SEEN })
    expect(updateTask).toHaveBeenCalledWith(T1, P, { columnId: COL_B })
    expect(result).toMatchObject({ id: T1 })
  })

  it('does not treat a row already in the target column as a conflict (lost-response replay)', async () => {
    vi.mocked(findTaskVersions).mockResolvedValue([row(T1, '2026-10-06T10:05:00.000Z', COL_B)])
    await updateBoardTask(T1, P, { columnId: COL_B, expectedUpdatedAt: SEEN })
    expect(updateTask).toHaveBeenCalledTimes(1)
  })

  it('keeps today\'s behaviour when no expected value is sent', async () => {
    await updateBoardTask(T1, P, { columnId: COL_B })
    expect(findTaskVersions).not.toHaveBeenCalled()
    expect(updateTask).toHaveBeenCalledWith(T1, P, { columnId: COL_B })
  })

  it('rejects an unparseable expected value instead of skipping the guard', async () => {
    await expect(updateBoardTask(T1, P, { columnId: COL_B, expectedUpdatedAt: 'nope' })).rejects.toThrow(/Invalid expectedUpdatedAt/)
    expect(updateTask).not.toHaveBeenCalled()
  })
})

describe('reorderBoardTasks stale-move guard', () => {
  it('refuses the whole batch when one moving card is stale', async () => {
    vi.mocked(findTaskVersions).mockResolvedValue([row(T1, SEEN), row(T2, '2026-10-06T11:00:00.000Z')])
    const result = await reorderBoardTasks(P, [
      { id: T1, orderIndex: 0, columnId: COL_B, expectedUpdatedAt: SEEN },
      { id: T2, orderIndex: 1, columnId: COL_B, expectedUpdatedAt: SEEN },
    ])
    expect(result).toEqual({ staleBoard: true, taskIds: [T2] })
    expect(reorderTasks).not.toHaveBeenCalled()
  })

  it('writes and returns the new updatedAt when every moving card is current', async () => {
    vi.mocked(findTaskVersions).mockResolvedValue([row(T1, SEEN)])
    const result = await reorderBoardTasks(P, [
      { id: T1, orderIndex: 0, columnId: COL_B, expectedUpdatedAt: SEEN },
      { id: T2, orderIndex: 1 },
    ])
    expect(findTaskVersions).toHaveBeenCalledWith(P, [T1])
    expect(reorderTasks).toHaveBeenCalledWith(P, [{ id: T1, orderIndex: 0, columnId: COL_B }, { id: T2, orderIndex: 1 }])
    expect(result).toEqual({ updatedAt: '2026-10-06T10:05:00.000Z' })
  })

  it('keeps today\'s behaviour for callers that send no expected values', async () => {
    await reorderBoardTasks(P, [{ id: T1, orderIndex: 0, columnId: COL_B }])
    expect(findTaskVersions).not.toHaveBeenCalled()
    expect(reorderTasks).toHaveBeenCalledTimes(1)
  })
})

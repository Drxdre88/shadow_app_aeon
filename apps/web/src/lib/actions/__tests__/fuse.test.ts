import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireEditor: vi.fn(),
}))

vi.mock('@/lib/data/fuse', () => ({
  fuseTasks: vi.fn(),
}))

vi.mock('@/lib/data/unfuse', () => ({
  unfuseTasks: vi.fn(),
}))

vi.mock('@/lib/data/activity', () => ({
  emitActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/kairos/auto-capture', () => ({
  captureBoardEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { requireEditor } from '@/lib/actions/helpers'
import { fuseTasks as _fuseTasks } from '@/lib/data/fuse'
import { unfuseTasks as _unfuseTasks } from '@/lib/data/unfuse'
import { emitActivity } from '@/lib/data/activity'
import { fuseBoardTasks, unfuseBoardTasks } from '../fuse'
import type { FuseSnapshot } from '@/lib/data/validators'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const SURVIVOR = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'

const snapshot: FuseSnapshot = {
  projectId: PROJECT,
  survivorId: SURVIVOR,
  sourceId: SOURCE,
  survivorBefore: { name: 'S', description: null, priority: 'low', startDate: null, endDate: null, onTimeline: false, size: null, estimateMinutes: null },
  source: {
    id: SOURCE, columnId: null, ganttTaskId: null, name: 'X', description: null, status: 'todo', priority: 'medium', color: 'purple',
    startDate: null, endDate: null, onTimeline: false, size: null, progress: null, orderIndex: 0, metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', completedAt: null, estimateMinutes: null,
    scheduleMode: 'auto', constraintType: 'asap', constraintDate: null, computedStart: null, computedEnd: null, totalFloatMin: null,
    isMilestone: false, ownerResourceId: null, startedAt: null,
  },
  sourceLabelIds: [], sourceAssignees: [], sourceVirtualAssignees: [],
  addedLabelIds: [], addedAssigneeIds: [], addedVirtualAssigneeIds: [],
  checklist: [], sourceEdges: [], insertedEdges: [], commentIds: [], sessionIds: [], memoryIds: [], ganttRows: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(_fuseTasks).mockResolvedValue({ survivor: { id: SURVIVOR, name: 'Fused' } as never, labelIds: [], snapshot })
})

describe('fuseBoardTasks', () => {
  it('requires an editor on the project, fuses through the data layer, logs both cards, revalidates', async () => {
    const result = await fuseBoardTasks({ projectId: PROJECT, survivorId: SURVIVOR, sourceId: SOURCE, name: '  Fused ' })

    expect(requireEditor).toHaveBeenCalledWith(PROJECT)
    expect(_fuseTasks).toHaveBeenCalledWith(PROJECT, SURVIVOR, SOURCE, 'Fused')
    expect(result.survivor.name).toBe('Fused')
    expect(emitActivity).toHaveBeenCalledWith(PROJECT, 'task', SURVIVOR, 'updated', 'Fused', { fusedFrom: SOURCE, fusedFromName: 'X' }, 'user-1')
    expect(emitActivity).toHaveBeenCalledWith(PROJECT, 'task', SOURCE, 'deleted', 'X', { fusedInto: SURVIVOR }, 'user-1')
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
  })

  it('rejects when the guard throws, before touching data', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(fuseBoardTasks({ projectId: PROJECT, survivorId: SURVIVOR, sourceId: SOURCE, name: 'Fused' })).rejects.toThrow('Viewers cannot modify')
    expect(_fuseTasks).not.toHaveBeenCalled()
  })

  it('rejects a self-fuse, an empty title and non-uuid ids', async () => {
    await expect(fuseBoardTasks({ projectId: PROJECT, survivorId: SURVIVOR, sourceId: SURVIVOR, name: 'Fused' })).rejects.toThrow()
    await expect(fuseBoardTasks({ projectId: PROJECT, survivorId: SURVIVOR, sourceId: SOURCE, name: '   ' })).rejects.toThrow()
    await expect(fuseBoardTasks({ projectId: PROJECT, survivorId: 'card-1', sourceId: SOURCE, name: 'Fused' })).rejects.toThrow()
    expect(_fuseTasks).not.toHaveBeenCalled()
    expect(requireEditor).not.toHaveBeenCalled()
  })
})

describe('unfuseBoardTasks', () => {
  it('requires an editor, restores through the data layer and logs the restore', async () => {
    await unfuseBoardTasks(PROJECT, snapshot)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT)
    expect(_unfuseTasks).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SOURCE, survivorId: SURVIVOR }))
    expect(emitActivity).toHaveBeenCalledWith(PROJECT, 'task', SOURCE, 'restored', 'X', { unfusedFrom: SURVIVOR }, 'user-1')
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
  })

  it('refuses a snapshot from another project and a malformed snapshot', async () => {
    await expect(unfuseBoardTasks(OTHER_PROJECT, snapshot)).rejects.toThrow('another project')
    await expect(unfuseBoardTasks(PROJECT, { ...snapshot, sourceId: 'nope' })).rejects.toThrow()
    expect(_unfuseTasks).not.toHaveBeenCalled()
    expect(requireEditor).not.toHaveBeenCalled()
  })
})

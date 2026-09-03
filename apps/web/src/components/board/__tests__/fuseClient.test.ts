import { describe, it, expect, beforeEach } from 'vitest'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { applyFuseOptimistic, captureFuseSlice, restoreFuseSlice } from '../fuseClient'

// The optimistic half of a fusion: what the board shows the instant the
// operator confirms, and that restoring the captured slice is an exact undo.

const task = (id: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  projectId: 'p1',
  name: id,
  columnId: 'col',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  ...extra,
})

function seed() {
  useBoardStore.setState({
    tasks: [
      task('s', { priority: 'low', labels: ['l1'], startDate: '2026-09-10T00:00:00.000Z', size: 1 }),
      task('x', { priority: 'high', labels: ['l2', 'l1'], startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-20T00:00:00.000Z', size: 2, description: 'extra' }),
      task('o'),
    ],
    dependencies: [
      { blockerTaskId: 'x', blockedTaskId: 'o' },
      { blockerTaskId: 's', blockedTaskId: 'x' },
    ],
    assigneesByTask: {
      s: [{ userId: 'u1', name: 'One', image: null }],
      x: [{ userId: 'u1', name: 'One', image: null }, { userId: 'u2', name: 'Two', image: null }],
    },
    checklistSummaries: { s: { checked: 1, crossed: 0, total: 2 }, x: { checked: 0, crossed: 1, total: 3 } },
    checklistPreviews: { x: [{ title: 'do it', state: 'unchecked', groupName: 'Checklist' }] },
  })
}

beforeEach(seed)

describe('applyFuseOptimistic', () => {
  it('merges the survivor, removes the source and re-points its relations', () => {
    const slice = captureFuseSlice(useBoardStore.getState(), 'x', 's')!
    applyFuseOptimistic(slice, 'Fused')

    const s = useBoardStore.getState()
    expect(s.tasks.map((t) => t.id).sort()).toEqual(['o', 's'])
    const survivor = s.tasks.find((t) => t.id === 's')!
    expect(survivor).toMatchObject({
      name: 'Fused',
      priority: 'high',
      labels: ['l1', 'l2'],
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-20T00:00:00.000Z',
      size: 3,
      description: 'extra',
      color: 'purple',
      columnId: 'col',
    })
    expect(s.dependencies).toEqual([{ blockerTaskId: 's', blockedTaskId: 'o' }])
    expect(s.assigneesByTask.s.map((p) => p.userId)).toEqual(['u1', 'u2'])
    expect(s.assigneesByTask.x).toBeUndefined()
    expect(s.checklistSummaries.s).toEqual({ checked: 1, crossed: 1, total: 5 })
    expect(s.checklistSummaries.x).toBeUndefined()
    expect(s.checklistPreviews.s).toEqual([{ title: 'do it', state: 'unchecked', groupName: 'Checklist' }])
  })
})

describe('restoreFuseSlice', () => {
  it('puts the store back exactly as it was captured', () => {
    const before = useBoardStore.getState()
    const slice = captureFuseSlice(before, 'x', 's')!
    applyFuseOptimistic(slice, 'Fused')
    restoreFuseSlice(slice)

    const after = useBoardStore.getState()
    const byId = (tasks: BoardTask[]) => [...tasks].sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(after.tasks)).toEqual(byId(before.tasks))
    expect(after.dependencies).toEqual(before.dependencies)
    expect(after.assigneesByTask).toEqual(before.assigneesByTask)
    expect(after.checklistSummaries).toEqual(before.checklistSummaries)
    expect(after.checklistPreviews).toEqual(before.checklistPreviews)
  })
})

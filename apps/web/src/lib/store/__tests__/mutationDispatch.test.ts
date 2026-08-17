import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn().mockResolvedValue('created'),
  updateBoardTask: vi.fn().mockResolvedValue('updated'),
  deleteBoardTask: vi.fn().mockResolvedValue('deleted'),
  reorderBoardTasks: vi.fn().mockResolvedValue('moved'),
}))

vi.mock('@/lib/actions/checklist', () => ({
  createChecklistItem: vi.fn().mockResolvedValue('cl-created'),
  updateChecklistItem: vi.fn().mockResolvedValue('cl-updated'),
  deleteChecklistItem: vi.fn().mockResolvedValue('cl-deleted'),
  renameChecklistGroup: vi.fn().mockResolvedValue(1),
  reorderChecklistItems: vi.fn().mockResolvedValue(undefined),
  deleteChecklistGroup: vi.fn().mockResolvedValue(undefined),
}))

import { dispatchMutation, isAlreadyApplied, type QueuedMutation } from '../mutationDispatch'
import * as board from '@/lib/actions/board'
import * as checklist from '@/lib/actions/checklist'

beforeEach(() => vi.clearAllMocks())

describe('dispatchMutation', () => {
  it('routes update to updateBoardTask with id/project/updates', async () => {
    const m: QueuedMutation = { id: 'm1', type: 'task.update', args: { taskId: 't1', projectId: 'p1', updates: { name: 'x' } } }
    await expect(dispatchMutation(m)).resolves.toBe('updated')
    expect(board.updateBoardTask).toHaveBeenCalledWith('t1', 'p1', { name: 'x' })
  })

  it('routes move to reorderBoardTasks with the updates array', async () => {
    const updates = [{ id: 't1', orderIndex: 2, columnId: 'c2' }]
    const m: QueuedMutation = { id: 'm2', type: 'task.move', args: { projectId: 'p1', updates } }
    await expect(dispatchMutation(m)).resolves.toBe('moved')
    expect(board.reorderBoardTasks).toHaveBeenCalledWith('p1', updates)
  })

  it('routes delete to deleteBoardTask', async () => {
    const m: QueuedMutation = { id: 'm3', type: 'task.delete', args: { taskId: 't9', projectId: 'p1' } }
    await expect(dispatchMutation(m)).resolves.toBe('deleted')
    expect(board.deleteBoardTask).toHaveBeenCalledWith('t9', 'p1')
  })

  it('routes checklist.create with the client item id for idempotent replay', async () => {
    const m: QueuedMutation = {
      id: 'm4',
      type: 'checklist.create',
      args: { itemId: 'i1', taskId: 't1', projectId: 'p1', title: 'buy milk', groupName: 'Checklist' },
    }
    await expect(dispatchMutation(m)).resolves.toBe('cl-created')
    expect(checklist.createChecklistItem).toHaveBeenCalledWith({
      id: 'i1', taskId: 't1', projectId: 'p1', title: 'buy milk', groupName: 'Checklist',
    })
  })

  it('routes checklist.update to updateChecklistItem', async () => {
    const m: QueuedMutation = {
      id: 'm5',
      type: 'checklist.update',
      args: { itemId: 'i1', taskId: 't1', projectId: 'p1', updates: { state: 'checked' } },
    }
    await expect(dispatchMutation(m)).resolves.toBe('cl-updated')
    expect(checklist.updateChecklistItem).toHaveBeenCalledWith('i1', 't1', 'p1', { state: 'checked' })
  })

  it('routes checklist.delete / reorder / group ops', async () => {
    await dispatchMutation({ id: 'm6', type: 'checklist.delete', args: { itemId: 'i1', taskId: 't1', projectId: 'p1' } })
    expect(checklist.deleteChecklistItem).toHaveBeenCalledWith('i1', 't1', 'p1')

    const updates = [{ id: 'i1', orderIndex: 0, groupName: 'A' }]
    await dispatchMutation({ id: 'm7', type: 'checklist.reorder', args: { taskId: 't1', projectId: 'p1', updates } })
    expect(checklist.reorderChecklistItems).toHaveBeenCalledWith('t1', 'p1', updates)

    await dispatchMutation({ id: 'm8', type: 'checklist.groupRename', args: { taskId: 't1', projectId: 'p1', oldName: 'A', newName: 'B' } })
    expect(checklist.renameChecklistGroup).toHaveBeenCalledWith('t1', 'p1', 'A', 'B')

    await dispatchMutation({ id: 'm9', type: 'checklist.groupDelete', args: { taskId: 't1', projectId: 'p1', groupName: 'B' } })
    expect(checklist.deleteChecklistGroup).toHaveBeenCalledWith('t1', 'p1', 'B')
  })
})

describe('isAlreadyApplied', () => {
  it('treats duplicate/unique-constraint errors as already applied', () => {
    expect(isAlreadyApplied(new Error('duplicate key value violates unique constraint "x"'))).toBe(true)
    expect(isAlreadyApplied(new Error('row already exists'))).toBe(true)
  })
  it('does not swallow ordinary errors', () => {
    expect(isAlreadyApplied(new Error('fetch failed'))).toBe(false)
    expect(isAlreadyApplied('nope')).toBe(false)
  })
})

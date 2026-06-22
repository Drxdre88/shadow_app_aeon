import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn().mockResolvedValue('created'),
  updateBoardTask: vi.fn().mockResolvedValue('updated'),
  deleteBoardTask: vi.fn().mockResolvedValue('deleted'),
  reorderBoardTasks: vi.fn().mockResolvedValue('moved'),
}))

import { dispatchMutation, isAlreadyApplied, type QueuedMutation } from '../mutationDispatch'
import * as board from '@/lib/actions/board'

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

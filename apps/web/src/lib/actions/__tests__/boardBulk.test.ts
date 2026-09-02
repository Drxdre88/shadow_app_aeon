import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireEditor: vi.fn(),
}))

vi.mock('@/lib/data/boardBulk', () => ({
  moveAllTasksToColumn: vi.fn(),
}))

vi.mock('@/lib/data/columns', () => ({
  findColumns: vi.fn(),
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
import { moveAllTasksToColumn as _moveAllTasksToColumn } from '@/lib/data/boardBulk'
import { findColumns as _findColumns } from '@/lib/data/columns'
import { emitActivity } from '@/lib/data/activity'
import { moveAllTasksToColumnAction } from '../boardBulk'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const FROM = '22222222-2222-4222-8222-222222222222'
const TO = '33333333-3333-4333-8333-333333333333'
const FOREIGN = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(_findColumns).mockResolvedValue([{ id: FROM }, { id: TO }] as never)
  vi.mocked(_moveAllTasksToColumn).mockResolvedValue([
    { id: 'a', name: 'A', orderIndex: 3 },
    { id: 'b', name: 'B', orderIndex: 4 },
  ])
})

describe('moveAllTasksToColumnAction', () => {
  it('requires an editor, moves through the data layer, logs each move and revalidates', async () => {
    const moved = await moveAllTasksToColumnAction(PROJECT, FROM, TO)

    expect(requireEditor).toHaveBeenCalledWith(PROJECT)
    expect(_moveAllTasksToColumn).toHaveBeenCalledWith(PROJECT, FROM, TO)
    expect(moved).toHaveLength(2)
    expect(emitActivity).toHaveBeenCalledTimes(2)
    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT, 'task', 'a', 'moved', 'A', { fromColumnId: FROM, toColumnId: TO }, 'user-1',
    )
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
  })

  it('rejects when the guard throws, before touching data', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))

    await expect(moveAllTasksToColumnAction(PROJECT, FROM, TO)).rejects.toThrow('Viewers cannot modify')
    expect(_moveAllTasksToColumn).not.toHaveBeenCalled()
  })

  it('rejects a same-column move and a column from another project', async () => {
    await expect(moveAllTasksToColumnAction(PROJECT, FROM, FROM)).rejects.toThrow('same')
    await expect(moveAllTasksToColumnAction(PROJECT, FROM, FOREIGN)).rejects.toThrow('Column not found')
    expect(_moveAllTasksToColumn).not.toHaveBeenCalled()
  })

  it('rejects non-uuid column ids', async () => {
    await expect(moveAllTasksToColumnAction(PROJECT, 'col-1', TO)).rejects.toThrow()
    expect(_moveAllTasksToColumn).not.toHaveBeenCalled()
  })
})

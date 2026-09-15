/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  spawn: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/store/mutationQueue', () => ({
  useMutationQueue: { getState: () => ({ enqueue: mocks.enqueue }) },
}))

vi.mock('@/lib/actions/hangar', () => ({ spawnSessionFromCard: mocks.spawn }))
vi.mock('@/components/ui/Toast', () => ({ toast: mocks.toast }))
vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn(),
  updateBoardTask: vi.fn(),
  reorderBoardTasks: vi.fn(),
  archiveBoardTask: vi.fn(),
  archiveColumnTasks: vi.fn(),
}))
vi.mock('@/lib/actions/columns', () => ({
  createColumn: vi.fn(),
  updateColumn: vi.fn(),
  reorderColumns: vi.fn(),
  deleteColumn: vi.fn(),
}))
vi.mock('@/lib/actions/vault', () => ({ sendToVault: vi.fn(), sendBatchToVault: vi.fn() }))

import { useBoardHandlers } from '../../../app/project/[id]/useBoardHandlers'

const PROJECT = 'project-1'
const TASK = 'task-1'
const updates = [{ id: TASK, orderIndex: 0, columnId: 'launch' }]
const snapshot = [{ id: TASK, orderIndex: 0, columnId: 'backlog' }]

function capturedEffects() {
  expect(mocks.enqueue).toHaveBeenCalledOnce()
  return mocks.enqueue.mock.calls[0][1] as { onSuccess: () => void; rollback: () => void }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.spawn.mockResolvedValue({ id: 'session-1' })
})

describe('useBoardHandlers auto-drop launch', () => {
  it('launches only after the queued column move reports durable success', async () => {
    const { result } = renderHook(() => useBoardHandlers(PROJECT))

    act(() => result.current.handleTaskMove(updates, snapshot, { autoRunTaskId: TASK, armedAt: Date.now() }))
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.move', args: { projectId: PROJECT, updates } }),
      expect.objectContaining({ onSuccess: expect.any(Function), rollback: expect.any(Function) }),
    )
    expect(mocks.spawn).not.toHaveBeenCalled()

    act(() => capturedEffects().onSuccess())
    await waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    expect(mocks.spawn).toHaveBeenCalledWith(PROJECT, TASK, 'auto-drop')
  })

  it('never spawns when the queued move is rejected and rolled back', () => {
    const { result } = renderHook(() => useBoardHandlers(PROJECT))

    act(() => result.current.handleTaskMove(updates, snapshot, { autoRunTaskId: TASK, armedAt: Date.now() }))
    act(() => capturedEffects().rollback())

    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not spawn after a move finally saves with an expired launch intent', () => {
    const { result } = renderHook(() => useBoardHandlers(PROJECT))

    act(() => result.current.handleTaskMove(updates, snapshot, {
      autoRunTaskId: TASK,
      armedAt: Date.now() - 60_001,
    }))
    act(() => capturedEffects().onSuccess())

    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Mission not launched — the move took too long to save')
  })
})

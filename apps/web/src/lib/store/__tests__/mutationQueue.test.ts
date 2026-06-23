import { describe, it, expect, vi, beforeEach } from 'vitest'

// Single-attempt passthrough so the queue's branching is fast/deterministic;
// the retry/backoff itself is covered in persistMutation.test.
vi.mock('../persistMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persistMutation')>()
  return { ...actual, withRetry: (run: () => Promise<unknown>) => run() }
})

// Mock the dispatcher (and inline the real already-applied classifier) so we
// never load the server-action / db modules in this unit test.
vi.mock('../mutationDispatch', () => ({
  dispatchMutation: vi.fn(),
  isAlreadyApplied: (err: unknown) =>
    err instanceof Error && /duplicate key|already exists|unique constraint/i.test(err.message),
}))

import { useMutationQueue } from '../mutationQueue'
import { dispatchMutation } from '../mutationDispatch'
import { useBoardStore } from '../boardStore'

const dispatch = vi.mocked(dispatchMutation)

const mut = (id: string) =>
  ({ id, type: 'task.update' as const, args: { taskId: 't1', projectId: 'p1', updates: { name: 'x' } } })

beforeEach(() => {
  useMutationQueue.setState({ pending: [], flushing: false })
  useBoardStore.setState({ saveStatus: 'idle' })
  dispatch.mockReset()
})

describe('mutationQueue', () => {
  it('drains a successful mutation and calls onSuccess', async () => {
    dispatch.mockResolvedValue({ ok: true })
    const onSuccess = vi.fn()
    useMutationQueue.getState().enqueue(mut('a'), { onSuccess })
    await vi.waitFor(() => expect(useMutationQueue.getState().pending).toHaveLength(0))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(useBoardStore.getState().saveStatus).toBe('saved')
  })

  it('drops and rolls back on a hard rejection', async () => {
    dispatch.mockRejectedValue(new Error('Viewers cannot modify this project'))
    const rollback = vi.fn()
    useMutationQueue.getState().enqueue(mut('c'), { rollback })
    await vi.waitFor(() => expect(rollback).toHaveBeenCalledTimes(1))
    expect(useMutationQueue.getState().pending).toHaveLength(0)
  })

  it('treats an already-applied (duplicate) replay as success', async () => {
    dispatch.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const rollback = vi.fn()
    const onSuccess = vi.fn()
    useMutationQueue.getState().enqueue(mut('d'), { rollback, onSuccess })
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(useMutationQueue.getState().pending).toHaveLength(0)
    expect(rollback).not.toHaveBeenCalled()
  })

  // Last: schedules an 8s re-flush timer; we null the queue so it no-ops.
  it('keeps the mutation queued and goes offline on a transient failure', async () => {
    dispatch.mockRejectedValue(new Error('fetch failed'))
    const rollback = vi.fn()
    useMutationQueue.getState().enqueue(mut('b'), { rollback })
    await vi.waitFor(() => expect(useBoardStore.getState().saveStatus).toBe('offline'))
    expect(useMutationQueue.getState().pending).toHaveLength(1) // never lost
    expect(rollback).not.toHaveBeenCalled()
    useMutationQueue.setState({ pending: [] })
  })
})

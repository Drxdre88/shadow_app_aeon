import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persistMutation')>()
  return { ...actual, withRetry: (run: () => Promise<unknown>) => run() }
})
vi.mock('../mutationDispatch', () => ({ dispatchMutation: vi.fn(), isAlreadyApplied: () => false }))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

import { useMutationQueue } from '../mutationQueue'
import { dispatchMutation, type QueuedMutation } from '../mutationDispatch'
import { useBoardStore, type BoardTask } from '../boardStore'
import { isTransientError } from '../persistMutation'
import { StaleBoardError } from '@/lib/utils/staleBoard'
import { STALE_MOVE_TOAST } from '../staleMoves'
import { toast } from '@/components/ui/Toast'

const dispatch = vi.mocked(dispatchMutation)
const SEEN = '2026-10-06T10:00:00.000Z'
const NEW = '2026-10-06T10:05:00.000Z'

const card = (id: string, updatedAt = SEEN): BoardTask => ({
  id, projectId: 'p1', name: id, status: 'todo', priority: 'medium', color: 'purple', labels: [],
  onTimeline: false, orderIndex: 0, columnId: 'colA', updatedAt,
})
const move = (id: string, expectedUpdatedAt = SEEN): QueuedMutation => ({
  id, type: 'task.move', args: { projectId: 'p1', updates: [{ id: 't1', orderIndex: 0, columnId: 'colB', expectedUpdatedAt }] },
})

beforeEach(() => {
  useMutationQueue.setState({ pending: [], flushing: false })
  useBoardStore.setState({ saveStatus: 'idle', tasks: [card('t1')], staleBoardSignal: 0 })
  dispatch.mockReset()
  vi.mocked(toast).mockReset()
})

describe('mutationQueue stale-move handling', () => {
  it('rolls back, explains, signals a reload and drops a STALE_BOARD refusal without retrying', async () => {
    dispatch.mockRejectedValue(new StaleBoardError(['t1']))
    const rollback = vi.fn()
    const onSuccess = vi.fn()
    useMutationQueue.getState().enqueue(move('m1'), { rollback, onSuccess })
    await vi.waitFor(() => expect(rollback).toHaveBeenCalledTimes(1))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(useMutationQueue.getState().pending).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith(STALE_MOVE_TOAST, { force: true })
    expect(useBoardStore.getState().staleBoardSignal).toBe(1)
    expect(useBoardStore.getState().saveStatus).toBe('error')
  })

  it('never classifies a stale refusal as transient', () => {
    expect(isTransientError(new StaleBoardError(['5034-0502-0504']))).toBe(false)
  })

  it('stamps the server version on the card and rebases the user\'s next queued move onto it', async () => {
    let release: (v: unknown) => void = () => {}
    dispatch.mockImplementationOnce(() => new Promise((r) => { release = r }))
    dispatch.mockResolvedValueOnce({ updatedAt: '2026-10-06T10:06:00.000Z' })
    useMutationQueue.getState().enqueue(move('m1'))
    useMutationQueue.getState().enqueue(move('m2'))
    release({ updatedAt: NEW })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    const second = dispatch.mock.calls[1][0] as Extract<QueuedMutation, { type: 'task.move' }>
    expect(second.args.updates[0].expectedUpdatedAt).toBe(NEW)
    await vi.waitFor(() => expect(useMutationQueue.getState().pending).toHaveLength(0))
    expect(useBoardStore.getState().tasks[0].updatedAt).toBe('2026-10-06T10:06:00.000Z')
    expect(useBoardStore.getState().staleBoardSignal).toBe(0)
  })

  it('replays a persisted offline move with its original expected version', async () => {
    dispatch.mockRejectedValue(new StaleBoardError(['t1']))
    useMutationQueue.setState({ pending: [move('offline-1', '2026-10-01T08:00:00.000Z')] })
    await useMutationQueue.getState().flush()
    const replayed = dispatch.mock.calls[0][0] as Extract<QueuedMutation, { type: 'task.move' }>
    expect(replayed.args.updates[0].expectedUpdatedAt).toBe('2026-10-01T08:00:00.000Z')
    expect(useMutationQueue.getState().pending).toHaveLength(0)
    expect(useBoardStore.getState().staleBoardSignal).toBe(1)
  })
})

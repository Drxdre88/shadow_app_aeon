import { describe, it, expect } from 'vitest'
import { withExpectedOnMoves, withExpectedOnUpdate, freshnessFromResult, rebasePending } from '../staleMoves'
import { findStaleTaskIds, throwIfStale, isStaleBoardError } from '@/lib/utils/staleBoard'
import type { BoardTask } from '../boardStore'
import type { QueuedMutation } from '../mutationDispatch'

const SEEN = '2026-10-06T10:00:00.000Z'
const card = (id: string, columnId: string): BoardTask => ({
  id, projectId: 'p1', name: id, status: 'todo', priority: 'medium', color: 'purple', labels: [],
  onTimeline: false, orderIndex: 0, columnId, updatedAt: SEEN,
})

describe('withExpectedOnMoves', () => {
  const tasks = [card('a', 'colA'), card('b', 'colB'), { ...card('c', 'colB'), updatedAt: undefined }]

  it('guards only entries that change column', () => {
    const out = withExpectedOnMoves(
      [{ id: 'a', orderIndex: 0, columnId: 'colB' }, { id: 'b', orderIndex: 1, columnId: 'colB' }, { id: 'b', orderIndex: 2 }],
      tasks,
      [{ id: 'a', columnId: 'colA' }, { id: 'b', columnId: 'colB' }],
    )
    expect(out[0].expectedUpdatedAt).toBe(SEEN)
    expect(out[1].expectedUpdatedAt).toBeUndefined()
    expect(out[2].expectedUpdatedAt).toBeUndefined()
  })

  it('guards conservatively without a snapshot and skips cards with no known version', () => {
    const out = withExpectedOnMoves([{ id: 'a', orderIndex: 0, columnId: 'colB' }, { id: 'c', orderIndex: 1, columnId: 'colA' }], tasks)
    expect(out[0].expectedUpdatedAt).toBe(SEEN)
    expect(out[1].expectedUpdatedAt).toBeUndefined()
  })
})

describe('withExpectedOnUpdate', () => {
  it('adds the version only for a column change', () => {
    expect(withExpectedOnUpdate({ columnId: 'colB' }, card('a', 'colA'))).toEqual({ columnId: 'colB', expectedUpdatedAt: SEEN })
    expect(withExpectedOnUpdate({ name: 'x' }, card('a', 'colA'))).toEqual({ name: 'x' })
  })
})

describe('freshness + rebase', () => {
  it('reads the server version from a Date or ISO result', () => {
    expect(freshnessFromResult(['a'], { updatedAt: new Date(SEEN) })).toEqual({ a: SEEN })
    expect(freshnessFromResult(['a', 'b'], { updatedAt: SEEN })).toEqual({ a: SEEN, b: SEEN })
    expect(freshnessFromResult(['a'], undefined)).toEqual({})
  })

  it('rebases only guarded entries of the touched cards', () => {
    const pending: QueuedMutation[] = [
      { id: 'm1', type: 'task.move', args: { projectId: 'p', updates: [{ id: 'a', orderIndex: 0, columnId: 'x', expectedUpdatedAt: 'old' }, { id: 'b', orderIndex: 1 }] } },
      { id: 'm2', type: 'task.update', args: { taskId: 'a', projectId: 'p', updates: { name: 'n' } } },
    ]
    const [m1, m2] = rebasePending(pending, { a: 'new', b: 'new' })
    expect((m1 as Extract<QueuedMutation, { type: 'task.move' }>).args.updates).toEqual([
      { id: 'a', orderIndex: 0, columnId: 'x', expectedUpdatedAt: 'new' }, { id: 'b', orderIndex: 1 },
    ])
    expect(m2).toBe(pending[1])
  })
})

describe('staleBoard rule', () => {
  const row = (iso: string, columnId = 'colA') => ({ id: 'a', updatedAt: new Date(iso), columnId })
  it('compares at millisecond precision and tolerates equal', () => {
    expect(findStaleTaskIds([{ id: 'a', expectedUpdatedAt: SEEN, columnId: 'colB' }], [row('2026-10-06T10:00:00.001Z')])).toEqual(['a'])
    expect(findStaleTaskIds([{ id: 'a', expectedUpdatedAt: SEEN, columnId: 'colB' }], [row(SEEN)])).toEqual([])
  })

  it('turns a returned refusal into a recognisable error', () => {
    expect(() => throwIfStale({ staleBoard: true, taskIds: ['a'] })).toThrow(/^STALE_BOARD:/)
    expect(isStaleBoardError(new Error('STALE_BOARD: x'))).toBe(true)
    expect(throwIfStale({ updatedAt: SEEN })).toEqual({ updatedAt: SEEN })
  })
})

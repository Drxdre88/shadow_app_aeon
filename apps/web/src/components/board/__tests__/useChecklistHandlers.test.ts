/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// arrangeItemAdd's pure output is covered in checklist/__tests__/groupOrder.test.ts.
// What was NOT covered is the half that reaches the database: turning that
// `reindex` into a SECOND queued mutation, behind the create, referencing the
// item the create just made. Get the pairing wrong and a checklist silently
// reshuffles itself on the next reload.

const getChecklistItems = vi.fn()
// Server-action modules reached transitively through the mutation queue's
// dispatcher — never invoked here, but they must not touch the DB at import.
vi.mock('@/lib/actions/checklist', () => ({
  getChecklistItems: (...args: unknown[]) => getChecklistItems(...args),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  renameChecklistGroup: vi.fn(),
  reorderChecklistItems: vi.fn(),
  deleteChecklistGroup: vi.fn(),
}))
vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn(),
  updateBoardTask: vi.fn(),
  deleteBoardTask: vi.fn(),
  reorderBoardTasks: vi.fn(),
}))

import { useChecklistHandlers } from '../useChecklistHandlers'
import { useMutationQueue } from '@/lib/store/mutationQueue'
import { useBoardStore } from '@/lib/store/boardStore'
import type { QueuedMutation } from '@/lib/store/mutationDispatch'
import type { MutationSideEffects } from '@/lib/store/mutationQueue'

const TASK_ID = 'task-1'
const PROJECT_ID = 'project-1'

type ServerItem = {
  id: string
  title: string
  completed: boolean
  state: string
  status: string | null
  groupName: string | null
  startDate: Date | null
  endDate: Date | null
}

const serverItem = (id: string, title: string, groupName: string): ServerItem => ({
  id,
  title,
  completed: false,
  state: 'unchecked',
  status: null,
  groupName,
  startDate: null,
  endDate: null,
})

let enqueue: ReturnType<typeof vi.fn>
const ORIGINAL_ENQUEUE = useMutationQueue.getState().enqueue

beforeEach(() => {
  enqueue = vi.fn()
  useMutationQueue.setState({ pending: [], enqueue })
  useBoardStore.setState({ checklistPreviews: {}, checklistSummaries: {} })
  getChecklistItems.mockResolvedValue([
    serverItem('item-a', 'Sketch it', 'Design'),
    serverItem('item-b', 'Build it', 'Build'),
  ])
})

afterEach(() => {
  useMutationQueue.setState({ pending: [], enqueue: ORIGINAL_ENQUEUE })
  vi.clearAllMocks()
})

/** Mounts the hook and waits for the server list to land (hydration gate). */
async function mountHydrated() {
  const view = renderHook(() => useChecklistHandlers(TASK_ID, PROJECT_ID))
  await act(async () => {})
  return view
}

/** The (mutation, sideEffects) pair from the nth enqueue call. */
function enqueued(n: number): { mutation: QueuedMutation; fx: MutationSideEffects } {
  const [mutation, fx] = enqueue.mock.calls[n] as [QueuedMutation, MutationSideEffects]
  return { mutation, fx }
}

describe('useChecklistHandlers — add + reindex queueing', () => {
  it('queues the reorder AFTER the create, carrying the created item', async () => {
    const { result } = await mountHydrated()

    // 'Design' is displayed FIRST, so the server's MAX(orderIndex)+1 append
    // would drop the new item below the 'Build' group.
    act(() => {
      expect(result.current.handleChecklistAdd('Wireframe', 'Design', ['Design', 'Build'])).toBe(true)
    })

    expect(enqueue).toHaveBeenCalledTimes(2)

    const create = enqueued(0).mutation
    const reorder = enqueued(1).mutation
    expect(create.type).toBe('checklist.create')
    expect(reorder.type).toBe('checklist.reorder')

    const createArgs = create.args as { itemId: string; taskId: string; projectId: string; title: string; groupName: string }
    expect(createArgs).toMatchObject({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      title: 'Wireframe',
      groupName: 'Design',
    })
    // Deliberately NO orderIndex on the create: the DB assigns MAX+1 globally
    // (group-local indices used to collide across groups).
    expect(createArgs).not.toHaveProperty('orderIndex')

    const reorderArgs = reorder.args as { taskId: string; projectId: string; updates: { id: string; orderIndex: number }[] }
    expect(reorderArgs.taskId).toBe(TASK_ID)
    expect(reorderArgs.projectId).toBe(PROJECT_ID)
    // The reorder must name the very item the create is about to make…
    expect(reorderArgs.updates.map((u) => u.id)).toContain(createArgs.itemId)
    // …at the position the user sees it in: right under 'Sketch it'.
    expect(reorderArgs.updates).toEqual([
      { id: 'item-a', orderIndex: 0 },
      { id: createArgs.itemId, orderIndex: 1 },
      { id: 'item-b', orderIndex: 2 },
    ])
  })

  it('the two mutations are distinct queue entries in FIFO order', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Wireframe', 'Design', ['Design', 'Build'])
    })
    const create = enqueued(0).mutation
    const reorder = enqueued(1).mutation
    // Same id would make the queue de-dupe/collide the pair.
    expect(create.id).not.toBe(reorder.id)
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[1])
  })

  it('the create rolls back to the pre-add snapshot', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Wireframe', 'Design', ['Design', 'Build'])
    })
    expect(result.current.checklistItems.map((i) => i.title)).toEqual(['Sketch it', 'Wireframe', 'Build it'])

    act(() => enqueued(0).fx.rollback?.())
    expect(result.current.checklistItems.map((i) => i.title)).toEqual(['Sketch it', 'Build it'])

    expect(enqueued(0).fx.failMessage).toBeTruthy()
    expect(enqueued(1).fx.failMessage).toBeTruthy()
  })

  // THE data-loss case. The reindex is queued BEHIND the create and used to
  // share its pre-add rollback. When the create commits and only the reorder is
  // rejected, that shared rollback stripped the item from the list — and from
  // the card-face summary — while its row was alive in Postgres. The user
  // retyped it and ended up with a duplicate on the next reload.
  it('a reorder failing AFTER the create committed keeps the created item', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Wireframe', 'Design', ['Design', 'Build'])
    })
    const createdId = (enqueued(0).mutation.args as { itemId: string }).itemId

    // Only the reorder is rejected; the create never rolled back.
    act(() => enqueued(1).fx.rollback?.())

    expect(result.current.checklistItems.map((i) => i.title)).toEqual(['Sketch it', 'Wireframe', 'Build it'])
    expect(result.current.checklistItems.some((i) => i.id === createdId)).toBe(true)
    // …and the card face still counts it, so reopening the card agrees.
    expect(useBoardStore.getState().checklistSummaries[TASK_ID]?.total).toBe(3)
  })

  // The other direction: when the create is rejected too (a viewer, say), the
  // reindex behind it must NOT resurrect a row the server never made.
  it('a reorder failing after the create ALSO failed leaves no phantom row', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Wireframe', 'Design', ['Design', 'Build'])
    })

    // FIFO: the create is decided first.
    act(() => enqueued(0).fx.rollback?.())
    act(() => enqueued(1).fx.rollback?.())

    expect(result.current.checklistItems.map((i) => i.title)).toEqual(['Sketch it', 'Build it'])
    expect(useBoardStore.getState().checklistSummaries[TASK_ID]?.total).toBe(2)
  })

  it('adding to the LAST displayed group needs no reindex — one enqueue only', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Ship it', 'Build', ['Design', 'Build'])
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueued(0).mutation.type).toBe('checklist.create')
  })

  it('with no on-screen group order there is nothing to reindex against', async () => {
    const { result } = await mountHydrated()
    act(() => {
      result.current.handleChecklistAdd('Loose item', 'Design')
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  // Before the server list arrives the rows on screen carry synthetic preview
  // ids; a reindex built from those would write nonsense.
  it('refuses the add — and queues nothing — while still hydrating', async () => {
    useBoardStore.setState({ checklistPreviews: { [TASK_ID]: [{ title: 'Sketch it', state: 'unchecked', groupName: 'Design' }] } })
    let pending!: () => void
    getChecklistItems.mockReturnValue(new Promise<ServerItem[]>((resolve) => { pending = () => resolve([]) }))

    const { result } = renderHook(() => useChecklistHandlers(TASK_ID, PROJECT_ID))
    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.handleChecklistAdd('Too early', 'Design', ['Design'])
    })
    expect(accepted).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()

    // …and once the real list lands the same add is accepted.
    await act(async () => { pending() })
    act(() => {
      expect(result.current.handleChecklistAdd('Now fine', 'Design', ['Design'])).toBe(true)
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})

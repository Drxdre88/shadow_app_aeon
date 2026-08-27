/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// The autosave contract of a pinned card window: DEBOUNCE while typing, FLUSH
// on blur / close / fold / unpin / unmount — and write NOTHING at all if the
// user never touched it. A pinned window seeds its form once, at mount, and
// can sit open for hours; an unconditional flush on close would push that
// stale snapshot over whatever the task became in the meantime.

// Server-action modules pulled in transitively by the card content — never
// exercised here, but they must not touch the DB layer at import time.
vi.mock('@/lib/actions/checklist', () => ({ getChecklistItems: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/actions/comments', () => ({
  getComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn(),
  editComment: vi.fn(),
  removeComment: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ updateProjectSettings: vi.fn() }))
vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn(),
  updateBoardTask: vi.fn(),
  deleteBoardTask: vi.fn(),
  reorderBoardTasks: vi.fn(),
}))

import { FloatingCardWindow } from '../FloatingCardWindow'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { usePinnedCardsStore, type PinnedCard } from '@/lib/store/pinnedCardsStore'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
/** Matches the component's autosave debounce. */
const DEBOUNCE_MS = 700

const TASK: BoardTask = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  name: 'Alpha card',
  description: 'original body',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
}

const CARD: PinnedCard = { taskId: TASK_ID, x: 120, y: 80, width: 480, folded: false, z: 1 }

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let onTaskUpdate: ReturnType<typeof vi.fn>
let onUnpin: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('IntersectionObserver', ObserverStub)
  vi.stubGlobal('ResizeObserver', ObserverStub)
  useBoardStore.setState({ tasks: [{ ...TASK }], labels: [] })
  usePinnedCardsStore.setState({ cards: [{ ...CARD }], nextZ: 2 })
  onTaskUpdate = vi.fn()
  onUnpin = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mountWindow() {
  const view = render(
    <FloatingCardWindow card={CARD} projectId={PROJECT_ID} onUnpin={onUnpin} onTaskUpdate={onTaskUpdate} />
  )
  // Flush the checklist fetch kicked off on mount.
  await act(async () => {})
  return view
}

const nameInput = () => screen.getByPlaceholderText('Task name...')
const typeName = (value: string) => act(() => { fireEvent.change(nameInput(), { target: { value } }) })
const storedName = () => useBoardStore.getState().tasks.find((t) => t.id === TASK_ID)?.name

describe('FloatingCardWindow autosave — debounce', () => {
  it('does not write on every keystroke', async () => {
    await mountWindow()
    typeName('A')
    typeName('Al')
    typeName('Alp')
    expect(onTaskUpdate).not.toHaveBeenCalled()
  })

  it('coalesces a burst of keystrokes into ONE write after the debounce', async () => {
    await mountWindow()
    typeName('A')
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS - 100) })
    typeName('Alpha card v2')
    // The earlier timer must have been reset, not left armed.
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS - 1) })
    expect(onTaskUpdate).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(onTaskUpdate).toHaveBeenCalledWith(TASK_ID, expect.objectContaining({ name: 'Alpha card v2' }), { silent: true })
  })
})

describe('FloatingCardWindow autosave — flush paths', () => {
  it('closing BEFORE the debounce fires writes the typed value exactly once', async () => {
    await mountWindow()
    typeName('Alpha card v2')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close pinned card' })) })

    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(onTaskUpdate).toHaveBeenCalledWith(TASK_ID, expect.objectContaining({ name: 'Alpha card v2' }), { silent: true })
    expect(storedName()).toBe('Alpha card v2')
    expect(usePinnedCardsStore.getState().cards).toEqual([])

    // The pending debounce timer was cancelled, not left to fire a duplicate.
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS * 2) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
  })

  it('unmounting mid-debounce still flushes', async () => {
    const { unmount } = await mountWindow()
    typeName('Saved by unmount')
    act(() => { unmount() })

    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(onTaskUpdate).toHaveBeenCalledWith(TASK_ID, expect.objectContaining({ name: 'Saved by unmount' }), { silent: true })
    expect(storedName()).toBe('Saved by unmount')

    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS * 2) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
  })

  it('blurring the field flushes immediately', async () => {
    await mountWindow()
    typeName('Saved by blur')
    act(() => { fireEvent.blur(nameInput()) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(storedName()).toBe('Saved by blur')
  })

  it('folding to the dock flushes', async () => {
    await mountWindow()
    typeName('Saved by fold')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Fold away' })) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(storedName()).toBe('Saved by fold')
    expect(usePinnedCardsStore.getState().cards[0].folded).toBe(true)
  })

  it('unpinning back to the modal flushes before handing over', async () => {
    await mountWindow()
    typeName('Saved by unpin')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Unpin (back to modal)' })) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(storedName()).toBe('Saved by unpin')
    expect(onUnpin).toHaveBeenCalledWith(TASK_ID)
  })

  it('Escape closes and flushes', async () => {
    await mountWindow()
    typeName('Saved by escape')
    act(() => { fireEvent.keyDown(screen.getByRole('dialog', { name: /Saved by escape/ }), { key: 'Escape' }) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
    expect(storedName()).toBe('Saved by escape')
  })
})

describe('FloatingCardWindow autosave — the stale-snapshot guard', () => {
  // THE data-loss case. The form is seeded at MOUNT; if a flush were
  // unconditional, closing a window nobody typed in would push that seed back
  // over a newer name (a peer's Pusher update, a context-menu rename).
  it('closing an UNTOUCHED window writes nothing, even after the task changed underneath', async () => {
    await mountWindow()
    act(() => { useBoardStore.getState().updateTask(TASK_ID, { name: 'Renamed by a peer', description: 'peer body' }) })

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close pinned card' })) })

    expect(onTaskUpdate).not.toHaveBeenCalled()
    const task = useBoardStore.getState().tasks.find((t) => t.id === TASK_ID)
    expect(task?.name).toBe('Renamed by a peer')
    expect(task?.description).toBe('peer body')
  })

  it('unmounting an UNTOUCHED window writes nothing', async () => {
    const { unmount } = await mountWindow()
    act(() => { useBoardStore.getState().updateTask(TASK_ID, { name: 'Renamed by a peer' }) })
    act(() => { unmount() })

    expect(onTaskUpdate).not.toHaveBeenCalled()
    expect(storedName()).toBe('Renamed by a peer')
  })

  it('blurring an UNTOUCHED field writes nothing', async () => {
    await mountWindow()
    act(() => { useBoardStore.getState().updateTask(TASK_ID, { name: 'Renamed by a peer' }) })
    act(() => { fireEvent.blur(nameInput()) })

    expect(onTaskUpdate).not.toHaveBeenCalled()
    expect(storedName()).toBe('Renamed by a peer')
  })

  it('once flushed the window goes clean again — a second close is silent', async () => {
    await mountWindow()
    typeName('Edited once')
    act(() => { fireEvent.blur(nameInput()) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)

    act(() => { fireEvent.blur(nameInput()) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close pinned card' })) })
    expect(onTaskUpdate).toHaveBeenCalledTimes(1)
  })

  it('an emptied name is never persisted over the real one', async () => {
    await mountWindow()
    typeName('')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close pinned card' })) })

    expect(onTaskUpdate).not.toHaveBeenCalled()
    expect(storedName()).toBe('Alpha card')
  })
})

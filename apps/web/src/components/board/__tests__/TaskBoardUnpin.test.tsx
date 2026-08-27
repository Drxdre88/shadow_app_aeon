/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// The unpin handover, end to end. A pinned floating window flushes its pending
// edit into the store and THEN asks the board to reopen the card as a modal.
// The board seeds that modal from the task — and it must read the task LIVE,
// because React has not re-rendered the board yet: the render closure still
// holds the pre-edit row. Seeding from it put the OLD title in the modal, and
// the modal's own autosave flush then wrote that stale title straight back over
// the edit the user had just made. Silent data loss, locally and on the server.

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
  duplicateBoardTask: vi.fn(),
}))
vi.mock('@/lib/actions/assignees', () => ({
  assignTaskMember: vi.fn(),
  unassignTaskMember: vi.fn(),
  assignTaskVirtualMember: vi.fn(),
  unassignTaskVirtualMember: vi.fn(),
  getTaskAssignees: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/actions/transfer', () => ({
  listProjectsForTransfer: vi.fn().mockResolvedValue([]),
  copyColumnToProject: vi.fn(),
  moveColumnToProject: vi.fn(),
  copyTaskToProject: vi.fn(),
  moveTaskToProject: vi.fn(),
}))
vi.mock('@/lib/actions/virtual-members', () => ({
  getAssignablePeople: vi.fn().mockResolvedValue({ members: [], virtualMembers: [] }),
  listVirtualMembersForProject: vi.fn().mockResolvedValue([]),
  createVirtualMemberAction: vi.fn(),
  updateVirtualMemberAction: vi.fn(),
  deleteVirtualMemberAction: vi.fn(),
}))

import { TaskBoard } from '../TaskBoard'
import { useBoardStore, type BoardTask, type BoardColumn } from '@/lib/store/boardStore'
import { usePinnedCardsStore, type PinnedCard } from '@/lib/store/pinnedCardsStore'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
const COLUMN_ID = 'column-1'

const COLUMN: BoardColumn = {
  id: COLUMN_ID,
  projectId: PROJECT_ID,
  name: 'Todo',
  color: 'purple',
  icon: null,
  orderIndex: 0,
}

const TASK: BoardTask = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  name: 'Alpha card',
  description: 'original body',
  columnId: COLUMN_ID,
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

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ObserverStub)
  vi.stubGlobal('ResizeObserver', ObserverStub)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  useBoardStore.setState({
    tasks: [{ ...TASK }],
    columns: [{ ...COLUMN }],
    labels: [],
    checklistSummaries: {},
    checklistPreviews: {},
  })
  usePinnedCardsStore.setState({ cards: [{ ...CARD }], nextZ: 2 })
  onTaskUpdate = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountBoard() {
  const view = render(<TaskBoard projectId={PROJECT_ID} onTaskUpdate={onTaskUpdate} />)
  await act(async () => {})
  return view
}

const nameInputs = () => screen.getAllByPlaceholderText('Task name...')
const storedTask = () => useBoardStore.getState().tasks.find((t) => t.id === TASK_ID)
const clickUnpin = () =>
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Unpin (back to modal)' })) })

describe('TaskBoard — unpin hands the LIVE task to the modal', () => {
  it('seeds the reopened modal with the edit the floating window just flushed', async () => {
    await mountBoard()

    // Type into the pinned window, then unpin before its 700ms debounce fires.
    // handleUnpin flushes first, so the store already holds the new title when
    // the board is asked to reopen the card.
    act(() => { fireEvent.change(nameInputs()[0], { target: { value: 'Alpha card v2' } }) })
    clickUnpin()

    expect(usePinnedCardsStore.getState().cards).toEqual([])
    expect(storedTask()?.name).toBe('Alpha card v2')

    // The modal is the only editor left, and it must show the NEW title.
    const inputs = nameInputs()
    expect(inputs).toHaveLength(1)
    expect((inputs[0] as HTMLInputElement).value).toBe('Alpha card v2')
  })

  it('the reopened modal never writes the pre-edit title back', async () => {
    await mountBoard()
    act(() => { fireEvent.change(nameInputs()[0], { target: { value: 'Alpha card v2' } }) })
    clickUnpin()
    onTaskUpdate.mockClear()

    // Any interaction that flushes the modal's autosave — a blur, closing it —
    // used to persist the stale seed over the edit.
    act(() => { fireEvent.blur(nameInputs()[0]) })
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })

    expect(storedTask()?.name).toBe('Alpha card v2')
    expect(onTaskUpdate).not.toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ name: 'Alpha card' }),
      expect.anything(),
    )
  })

  // The modal seeds its form ONCE, when the card opens, and can sit there while
  // the task drifts underneath it. An unconditional flush would push that stale
  // seed back — the same hole the floating window closed with a dirty flag.
  it('an UNTOUCHED modal writes nothing, even after the task changed underneath', async () => {
    await mountBoard()
    clickUnpin() // opens the modal, seeded, with nothing typed in it
    onTaskUpdate.mockClear()

    // A peer's rename lands while the modal sits open and untouched.
    act(() => { useBoardStore.getState().updateTask(TASK_ID, { name: 'Renamed by a peer' }) })

    act(() => { fireEvent.blur(nameInputs()[0]) })

    expect(onTaskUpdate).not.toHaveBeenCalled()
    expect(storedTask()?.name).toBe('Renamed by a peer')
  })
})

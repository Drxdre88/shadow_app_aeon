/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

// Virtual-member management inside the assignee overlay. Deleting a virtual
// member strips that person's assignments across EVERY project in the realm,
// so this surface has two hard requirements:
//   1. the two-click arm is the only way to fire it, and a stale arm never
//      survives the overlay closing;
//   2. a failed delete reverts SURGICALLY — the member and its own pills come
//      back, and nothing the user did meanwhile is erased. A snapshot-restore
//      of the whole assignee map would silently wipe assignments made while
//      the delete was in flight.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

vi.mock('@/lib/actions/assignees', () => ({
  assignTaskAction: vi.fn().mockResolvedValue(null),
  unassignTaskAction: vi.fn().mockResolvedValue(null),
  assignVirtualTaskAction: vi.fn().mockResolvedValue(null),
  unassignVirtualTaskAction: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/actions/virtual-members', () => ({
  getAssignablePeople: vi.fn(),
  createVirtualMemberAction: vi.fn(),
  updateVirtualMemberAction: vi.fn().mockResolvedValue(null),
  deleteVirtualMemberAction: vi.fn().mockResolvedValue(true),
}))

// The cache is covered by its own suite; here it just has to be inert and
// deterministic so the overlay paints from a known member list.
vi.mock('@/lib/store/membersCache', () => ({
  peekAssignablePeople: vi.fn(() => ({ members: [], virtualMembers: [] })),
  getAssignablePeopleCached: vi.fn(() => Promise.resolve({ members: [], virtualMembers: [] })),
  invalidateAssignablePeople: vi.fn(),
}))

import { TaskAssigneeOverlay } from '../TaskAssigneeOverlay'
import { useBoardStore, type BoardTask, type TaskAssigneePill, type VirtualMemberLite } from '@/lib/store/boardStore'
import {
  createVirtualMemberAction,
  updateVirtualMemberAction,
  deleteVirtualMemberAction,
} from '@/lib/actions/virtual-members'
import { invalidateAssignablePeople } from '@/lib/store/membersCache'
import { toast } from '@/components/ui/Toast'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
const OTHER_TASK = 'task-2'

const GHOST: VirtualMemberLite = { id: 'vm-1', name: 'Ghost', initials: 'GH', color: 'purple' }
const WRAITH: VirtualMemberLite = { id: 'vm-2', name: 'Wraith', initials: 'WR', color: 'blue' }

const ghostPill: TaskAssigneePill = { userId: 'vm-1', name: 'Ghost', image: null, kind: 'virtual', color: 'purple' }

const task = (id: string, name: string): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name,
  columnId: 'col-1',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
})

function seed(assigneesByTask: Record<string, TaskAssigneePill[]> = {}) {
  useBoardStore.setState({
    tasks: [task(TASK_ID, 'Alpha card'), task(OTHER_TASK, 'Beta card')],
    columns: [],
    labels: [],
    virtualMembers: [GHOST, WRAITH],
    assigneesByTask,
  })
}

async function renderOverlay(taskId: string | null = TASK_ID) {
  const utils = render(
    <TaskAssigneeOverlay projectId={PROJECT_ID} taskId={taskId} onClose={() => {}} />,
  )
  await act(async () => {}) // settle the member-cache effect
  return utils
}

/** Arms the two-click delete for the named member and returns the armed button. */
function armDelete(name: string) {
  const row = screen.getByText(name).closest('div.group')!
  const trash = row.querySelector<HTMLButtonElement>('button[title="Delete virtual member"]')!
  fireEvent.click(trash)
  return screen.getByTitle('Click again to delete')
}

const ids = () => useBoardStore.getState().virtualMembers.map((v) => v.id)
const pillIds = (taskId: string) =>
  (useBoardStore.getState().assigneesByTask[taskId] ?? []).map((p) => p.userId)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(deleteVirtualMemberAction).mockResolvedValue(true)
  vi.mocked(updateVirtualMemberAction).mockResolvedValue(null as never)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  }
  seed()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('virtual member delete — arming', () => {
  it('the first trash click only arms; nothing is deleted', async () => {
    await renderOverlay()

    armDelete('Ghost')

    expect(deleteVirtualMemberAction).not.toHaveBeenCalled()
    expect(ids()).toEqual(['vm-1', 'vm-2'])
    expect(screen.getByText('Ghost')).toBeTruthy()
  })

  it('the second click on the ARMED button fires the delete', async () => {
    await renderOverlay()

    fireEvent.click(armDelete('Ghost'))

    expect(deleteVirtualMemberAction).toHaveBeenCalledTimes(1)
    expect(deleteVirtualMemberAction).toHaveBeenCalledWith(PROJECT_ID, 'vm-1')
    // Optimistic: gone from the store immediately.
    expect(ids()).toEqual(['vm-2'])
  })

  it('arming one member does not arm another', async () => {
    await renderOverlay()

    armDelete('Ghost')
    const wraithRow = screen.getByText('Wraith').closest('div.group')!
    const wraithTrash = wraithRow.querySelector<HTMLButtonElement>('button[title="Delete virtual member"]')!
    fireEvent.click(wraithTrash)

    expect(deleteVirtualMemberAction).not.toHaveBeenCalled()
  })

  it('the arm does NOT survive closing and reopening the overlay', async () => {
    const { rerender } = await renderOverlay()

    armDelete('Ghost')
    expect(screen.queryByTitle('Click again to delete')).toBeTruthy()

    // Close…
    rerender(<TaskAssigneeOverlay projectId={PROJECT_ID} taskId={null} onClose={() => {}} />)
    await act(async () => {})
    // …and reopen on the same card.
    rerender(<TaskAssigneeOverlay projectId={PROJECT_ID} taskId={TASK_ID} onClose={() => {}} />)
    await act(async () => {})

    // A surviving arm would mean one stray click deletes a person.
    expect(screen.queryByTitle('Click again to delete')).toBeNull()

    // And the first click after reopening only re-arms.
    armDelete('Ghost')
    expect(deleteVirtualMemberAction).not.toHaveBeenCalled()
  })
})

describe('virtual member delete — rollback', () => {
  it('a rejected delete restores the member AND every pill it owned', async () => {
    seed({ [TASK_ID]: [ghostPill], [OTHER_TASK]: [ghostPill] })
    vi.mocked(deleteVirtualMemberAction).mockRejectedValue(new Error('realm editor required'))
    await renderOverlay()

    fireEvent.click(armDelete('Ghost'))

    // Optimistically gone from both cards…
    expect(pillIds(TASK_ID)).toEqual([])
    expect(pillIds(OTHER_TASK)).toEqual([])

    await waitFor(() => expect(ids()).toContain('vm-1'))

    // …and back, in its original slot, on both cards.
    expect(ids()).toEqual(['vm-1', 'vm-2'])
    expect(pillIds(TASK_ID)).toEqual(['vm-1'])
    expect(pillIds(OTHER_TASK)).toEqual(['vm-1'])
    expect(toast).toHaveBeenCalled()
  })

  // THE regression this whole suite exists for.
  it('a delete that fails AFTER another assignment lands must not wipe that assignment', async () => {
    seed({ [TASK_ID]: [ghostPill] })
    let rejectDelete: (e: Error) => void = () => {}
    vi.mocked(deleteVirtualMemberAction).mockReturnValue(
      new Promise((_res, rej) => { rejectDelete = rej }) as Promise<boolean>,
    )
    await renderOverlay()

    fireEvent.click(armDelete('Ghost'))
    expect(pillIds(TASK_ID)).toEqual([])

    // While the delete is still in flight the user assigns someone else to the
    // same card.
    fireEvent.click(screen.getByText('Wraith'))
    await act(async () => {})
    expect(pillIds(TASK_ID)).toEqual(['vm-2'])

    // Now the delete fails.
    await act(async () => {
      rejectDelete(new Error('realm editor required'))
      await Promise.resolve()
    })
    await waitFor(() => expect(pillIds(TASK_ID)).toContain('vm-1'))

    // A whole-map snapshot restore would have written back ['vm-1'] and
    // silently erased Wraith. Both must be present.
    expect(pillIds(TASK_ID).sort()).toEqual(['vm-1', 'vm-2'])
    expect(ids()).toEqual(['vm-1', 'vm-2'])
  })

  it('does not double-add a pill the server-side state already restored', async () => {
    seed({ [TASK_ID]: [ghostPill] })
    let rejectDelete: (e: Error) => void = () => {}
    vi.mocked(deleteVirtualMemberAction).mockReturnValue(
      new Promise((_res, rej) => { rejectDelete = rej }) as Promise<boolean>,
    )
    await renderOverlay()

    fireEvent.click(armDelete('Ghost'))
    // A board refresh (realtime) puts the pill back before the failure lands.
    act(() => { useBoardStore.getState().setTaskAssignees(TASK_ID, [ghostPill]) })

    await act(async () => {
      rejectDelete(new Error('boom'))
      await Promise.resolve()
    })
    await waitFor(() => expect(ids()).toContain('vm-1'))

    expect(pillIds(TASK_ID)).toEqual(['vm-1'])
  })

  it('a successful delete stays deleted and invalidates the member cache', async () => {
    seed({ [TASK_ID]: [ghostPill] })
    await renderOverlay()

    fireEvent.click(armDelete('Ghost'))
    await act(async () => {})

    expect(ids()).toEqual(['vm-2'])
    expect(pillIds(TASK_ID)).toEqual([])
    expect(invalidateAssignablePeople).toHaveBeenCalledWith(PROJECT_ID)
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('virtual member create', () => {
  function fillCreateForm(name: string) {
    fireEvent.click(screen.getByText('New'))
    fireEvent.change(screen.getByPlaceholderText('Name (no account needed)'), { target: { value: name } })
    fireEvent.click(screen.getByText('Add'))
  }

  it('a rejected create leaves the store untouched and tells the user', async () => {
    vi.mocked(createVirtualMemberAction).mockRejectedValue(new Error('not in a realm'))
    await renderOverlay()

    fillCreateForm('Phantom')
    await waitFor(() => expect(toast).toHaveBeenCalled())

    // No half-created row left behind.
    expect(ids()).toEqual(['vm-1', 'vm-2'])
    expect(useBoardStore.getState().virtualMembers.some((v) => v.name === 'Phantom')).toBe(false)
  })

  it('a successful create lands in the store and invalidates the cache', async () => {
    vi.mocked(createVirtualMemberAction).mockResolvedValue(
      { id: 'vm-3', name: 'Phantom', initials: 'PH', color: 'purple' } as never,
    )
    await renderOverlay()

    fillCreateForm('Phantom')
    await waitFor(() => expect(ids()).toEqual(['vm-1', 'vm-2', 'vm-3']))

    expect(createVirtualMemberAction).toHaveBeenCalledWith(PROJECT_ID, { name: 'Phantom', color: 'purple' })
    expect(invalidateAssignablePeople).toHaveBeenCalledWith(PROJECT_ID)
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('virtual member rename', () => {
  it('a rejected rename reverts the member and its pills without touching others', async () => {
    seed({ [TASK_ID]: [ghostPill] })
    vi.mocked(updateVirtualMemberAction).mockRejectedValue(new Error('nope'))
    await renderOverlay()

    const row = screen.getByText('Ghost').closest('div.group')!
    fireEvent.click(row.querySelector<HTMLButtonElement>('button[title="Rename / recolor"]')!)
    const input = screen.getByDisplayValue('Ghost')
    fireEvent.change(input, { target: { value: 'Spectre' } })
    fireEvent.click(screen.getByText('Save'))

    // Optimistic rename reached the pill too.
    expect(useBoardStore.getState().assigneesByTask[TASK_ID][0].name).toBe('Spectre')

    await waitFor(() => expect(toast).toHaveBeenCalled())

    expect(useBoardStore.getState().virtualMembers.find((v) => v.id === 'vm-1')!.name).toBe('Ghost')
    expect(useBoardStore.getState().assigneesByTask[TASK_ID][0].name).toBe('Ghost')
    expect(ids()).toEqual(['vm-1', 'vm-2'])
  })
})

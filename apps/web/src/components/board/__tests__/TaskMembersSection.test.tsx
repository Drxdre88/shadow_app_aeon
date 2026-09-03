/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// The card-edit view's Members row: renders the current assignees with the
// same avatar rules as the card face (stored initials win, virtual members get
// the dashed ring), removes through the same actions the card face uses, and
// "Add member" opens the shared assignee picker rather than a forked list.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

vi.mock('@/lib/actions/assignees', () => ({
  assignTaskAction: vi.fn().mockResolvedValue(null),
  unassignTaskAction: vi.fn().mockResolvedValue(null),
  assignVirtualTaskAction: vi.fn().mockResolvedValue(null),
  unassignVirtualTaskAction: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/actions/member-profiles', () => ({
  setMemberProfileAction: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/actions/virtual-members', () => ({
  getAssignablePeople: vi.fn(),
  createVirtualMemberAction: vi.fn(),
  updateVirtualMemberAction: vi.fn().mockResolvedValue(null),
  deleteVirtualMemberAction: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/store/membersCache', () => ({
  peekAssignablePeople: vi.fn(() => ({ members: [], virtualMembers: [] })),
  getAssignablePeopleCached: vi.fn(() => Promise.resolve({
    members: [
      { userId: 'u-1', role: 'owner', name: 'Ada Lovelace', email: 'ada@example.com', image: null, initials: 'AL', color: null },
      { userId: 'u-2', role: 'editor', name: 'Grace Hopper', email: 'grace@example.com', image: null, initials: null, color: null },
    ],
    virtualMembers: [],
  })),
  invalidateAssignablePeople: vi.fn(),
}))

import { TaskMembersSection } from '../TaskMembersSection'
import { useBoardStore, type BoardTask, type TaskAssigneePill } from '@/lib/store/boardStore'
import { unassignTaskAction, unassignVirtualTaskAction } from '@/lib/actions/assignees'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'

const ada: TaskAssigneePill = { userId: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com', image: null, initials: 'ADA', color: 'blue' }
const ghost: TaskAssigneePill = { userId: 'vm-1', name: 'Ghost', image: null, kind: 'virtual', initials: 'GH', color: 'purple' }

const task: BoardTask = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  name: 'Alpha card',
  columnId: 'col-1',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
}

const pillIds = () => (useBoardStore.getState().assigneesByTask[TASK_ID] ?? []).map((p) => p.userId)

beforeEach(() => {
  vi.clearAllMocks()
  useBoardStore.setState({
    tasks: [task],
    columns: [],
    labels: [],
    virtualMembers: [{ id: 'vm-1', name: 'Ghost', initials: 'GH', color: 'purple' }],
    assigneesByTask: { [TASK_ID]: [ada, ghost] },
  })
})

afterEach(() => cleanup())

describe('TaskMembersSection', () => {
  it('renders every assignee with stored initials and marks virtual members', () => {
    render(<TaskMembersSection taskId={TASK_ID} projectId={PROJECT_ID} />)

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Ghost')).toBeTruthy()
    // Custom initials from the member profile win over the derived "AL".
    expect(screen.getByText('ADA')).toBeTruthy()
    expect(screen.getByTitle('Ghost (virtual)').textContent).toBe('GH')
  })

  it('shows an empty hint when nobody is assigned', () => {
    useBoardStore.setState({ assigneesByTask: {} })
    render(<TaskMembersSection taskId={TASK_ID} projectId={PROJECT_ID} />)

    expect(screen.getByText(/Nobody yet/)).toBeTruthy()
  })

  it('removing a real or virtual member goes through the card-face actions, optimistically', async () => {
    render(<TaskMembersSection taskId={TASK_ID} projectId={PROJECT_ID} />)

    fireEvent.click(screen.getByLabelText('Remove Ada Lovelace'))
    expect(pillIds()).toEqual(['vm-1'])

    fireEvent.click(screen.getByLabelText('Remove Ghost'))
    expect(pillIds()).toEqual([])

    await act(async () => {})
    expect(unassignTaskAction).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, 'u-1')
    expect(unassignVirtualTaskAction).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, 'vm-1')
  })

  it('"Add member" opens the shared assignee picker with the project members, and Escape closes only it', async () => {
    render(<TaskMembersSection taskId={TASK_ID} projectId={PROJECT_ID} />)
    expect(screen.queryByPlaceholderText('Search by name or email')).toBeNull()

    fireEvent.click(screen.getByText('Add member'))
    await act(async () => {})

    expect(screen.getByPlaceholderText('Search by name or email')).toBeTruthy()
    expect(screen.getByText('Grace Hopper')).toBeTruthy()
    expect(screen.getByText('grace@example.com')).toBeTruthy()

    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', outer)

    expect(screen.queryByPlaceholderText('Search by name or email')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
  })
})

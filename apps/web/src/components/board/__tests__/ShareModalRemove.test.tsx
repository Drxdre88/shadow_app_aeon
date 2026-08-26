/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// Removing a member is optimistic: the row goes immediately and comes back if
// the server rejects. The restore has to put back THAT ROW ONLY. Restoring a
// list snapshotted from the render closure resurrected every row a concurrent
// removal had already taken out — the second person reappeared as a member of a
// project they had just been removed from.

const getProjectMembers = vi.fn()
const getPendingInvites = vi.fn()
const removeProjectMember = vi.fn()

vi.mock('@/lib/actions/members', () => ({
  getProjectMembers: (...a: unknown[]) => getProjectMembers(...a),
  getPendingInvites: (...a: unknown[]) => getPendingInvites(...a),
  removeProjectMember: (...a: unknown[]) => removeProjectMember(...a),
  inviteMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
}))
vi.mock('@/lib/store/membersCache', () => ({
  invalidateAssignablePeople: vi.fn(),
  prefetchAssignablePeople: vi.fn(),
}))
vi.mock('@/lib/actions/snapshots', () => ({ createBoardSnapshot: vi.fn() }))
vi.mock('@/lib/actions/contacts', () => ({
  autoSaveContact: vi.fn().mockResolvedValue(undefined),
  searchContacts: vi.fn().mockResolvedValue([]),
}))
vi.mock('html-to-image', () => ({ toPng: vi.fn() }))

import { ShareModal } from '../ShareModal'

const PROJECT_ID = 'project-1'

const member = (userId: string, name: string, role = 'editor') => ({
  userId,
  role,
  name,
  email: `${userId}@example.com`,
  image: null,
  createdAt: new Date(0),
})

beforeEach(() => {
  getProjectMembers.mockResolvedValue([
    member('owner-1', 'Owner', 'owner'),
    member('user-a', 'Ada'),
    member('user-b', 'Bo'),
  ])
  getPendingInvites.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openModal() {
  const view = render(
    <ShareModal isOpen projectId={PROJECT_ID} projectName="Aeon" onClose={() => {}} />
  )
  await act(async () => {})
  return view
}

const removeButton = (name: string) => screen.getByRole('button', { name: `Remove ${name}` })
const rowNames = () => screen.queryAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label'))

describe('ShareModal — optimistic member removal', () => {
  it('restores only the failed row when two removals overlap', async () => {
    // Ada's removal hangs, then rejects. Bo's succeeds in between.
    let rejectAda!: (err: Error) => void
    removeProjectMember.mockImplementation((_projectId: string, userId: string) => {
      if (userId === 'user-a') return new Promise((_res, rej) => { rejectAda = rej })
      return Promise.resolve()
    })

    await openModal()
    expect(rowNames()).toEqual(['Remove Ada', 'Remove Bo'])

    act(() => { fireEvent.click(removeButton('Ada')) })
    act(() => { fireEvent.click(removeButton('Bo')) })
    await act(async () => {})
    expect(rowNames()).toEqual([])

    await act(async () => { rejectAda(new Error('nope')) })

    // Ada comes back — Bo, already removed successfully, must NOT.
    expect(rowNames()).toEqual(['Remove Ada'])
    expect(screen.queryByText('Bo')).toBeNull()
  })

  it('a lone failed removal still restores its row', async () => {
    removeProjectMember.mockRejectedValue(new Error('nope'))
    await openModal()

    await act(async () => { fireEvent.click(removeButton('Ada')) })

    expect(rowNames()).toEqual(['Remove Ada', 'Remove Bo'])
  })

  it('does not duplicate the row if it is already back', async () => {
    let rejectAda!: (err: Error) => void
    removeProjectMember.mockImplementation(() => new Promise((_res, rej) => { rejectAda = rej }))
    await openModal()

    act(() => { fireEvent.click(removeButton('Ada')) })
    await act(async () => { rejectAda(new Error('nope')) })
    expect(rowNames().filter((n) => n === 'Remove Ada')).toHaveLength(1)
  })
})

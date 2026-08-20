/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'

// The realtime half of the comment fix: a peer's comment arrives as a Pusher
// board-update, which bumps a store counter instead of reloading the board.
// This pins that the open thread actually reacts to that counter.

const mocks = vi.hoisted(() => ({ getComments: vi.fn() }))

vi.mock('@/lib/actions/comments', () => ({
  getComments: mocks.getComments,
  addComment: vi.fn(),
  editComment: vi.fn(),
  removeComment: vi.fn(),
}))

import { TaskComments } from '../TaskComments'
import { useBoardStore } from '@/lib/store/boardStore'

const TASK_ID = 'task-1'
const PROJECT_ID = 'project-1'

let observerCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null

class MockIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observerCallback = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function comment(id: string, content: string) {
  return {
    id,
    taskId: TASK_ID,
    userId: 'user-1',
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
    userName: 'Ada',
    userImage: null,
  }
}

async function scrollIntoView() {
  await act(async () => {
    observerCallback?.([{ isIntersecting: true }])
  })
}

async function bumpCommentsSignal() {
  await act(async () => {
    useBoardStore.getState().bumpCommentsSignal()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  observerCallback = null
  useBoardStore.setState({ commentsSignal: 0 })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TaskComments', () => {
  it('stays lazy until the thread scrolls into view', async () => {
    mocks.getComments.mockResolvedValue([])

    render(<TaskComments taskId={TASK_ID} projectId={PROJECT_ID} />)

    expect(mocks.getComments).not.toHaveBeenCalled()

    await scrollIntoView()

    expect(mocks.getComments).toHaveBeenCalledWith(TASK_ID, PROJECT_ID)
  })

  it("refetches an open thread when a peer's comment signal arrives", async () => {
    mocks.getComments.mockResolvedValueOnce([comment('c1', 'First comment')])
    render(<TaskComments taskId={TASK_ID} projectId={PROJECT_ID} />)
    await scrollIntoView()
    expect(await screen.findByText('First comment')).toBeDefined()

    mocks.getComments.mockResolvedValueOnce([comment('c1', 'First comment'), comment('c2', 'Peer comment')])
    await bumpCommentsSignal()

    expect(await screen.findByText('Peer comment')).toBeDefined()
    expect(mocks.getComments).toHaveBeenCalledTimes(2)
  })

  it('ignores the signal while the thread has never been opened', async () => {
    mocks.getComments.mockResolvedValue([])

    render(<TaskComments taskId={TASK_ID} projectId={PROJECT_ID} />)
    await bumpCommentsSignal()

    expect(mocks.getComments).not.toHaveBeenCalled()
  })

  it('keeps the comments on screen when a signal refetch fails', async () => {
    mocks.getComments.mockResolvedValueOnce([comment('c1', 'First comment')])
    render(<TaskComments taskId={TASK_ID} projectId={PROJECT_ID} />)
    await scrollIntoView()
    await screen.findByText('First comment')

    mocks.getComments.mockRejectedValueOnce(new Error('offline'))
    await bumpCommentsSignal()

    await waitFor(() => expect(mocks.getComments).toHaveBeenCalledTimes(2))
    expect(screen.getByText('First comment')).toBeDefined()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjectFeedInfo: vi.fn() }))
vi.mock('@/lib/data/board-feed', () => ({ listChecklistForTasks: vi.fn(), listBoardColumnsForFeed: vi.fn() }))
vi.mock('../moment/gate/note', () => ({ noteKairosBreak: vi.fn() }))

import { captureMemory } from '@/lib/data/memories'
import { findProjectFeedInfo } from '@/lib/data/projects'
import { noteKairosBreak } from '../moment/gate/note'
import { captureBoardEvent, captureProjectEvent } from '../auto-capture'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VORATH_USER_IDS', 'owner')
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'm' }, created: true } as never)
  vi.mocked(findProjectFeedInfo).mockResolvedValue(null as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('auto-capture is owner-only', () => {
  it('skips a beta tester board event before any read or write', async () => {
    await captureBoardEvent({ userId: 'tester', projectId: 'p1', taskId: 't1', taskName: 'Card', action: 'completed' })
    expect(captureMemory).not.toHaveBeenCalled()
    expect(findProjectFeedInfo).not.toHaveBeenCalled()
    expect(noteKairosBreak).not.toHaveBeenCalled()
  })

  it('skips a beta tester project event', async () => {
    await captureProjectEvent({ userId: 'tester', projectId: 'p1', projectName: 'Board', action: 'created' })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('still captures for the owner', async () => {
    await captureBoardEvent({ userId: 'owner', projectId: 'p1', taskId: 't1', taskName: 'Card', action: 'created' })
    await captureProjectEvent({ userId: 'owner', projectId: 'p1', projectName: 'Board', action: 'created' })
    expect(captureMemory).toHaveBeenCalledTimes(2)
    expect(vi.mocked(captureMemory).mock.calls.every(([userId]) => userId === 'owner')).toBe(true)
  })
})

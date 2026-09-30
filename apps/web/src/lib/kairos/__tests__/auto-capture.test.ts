import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjectSettings: vi.fn() }))
vi.mock('@/lib/data/board-feed', () => ({ listChecklistForTasks: vi.fn() }))

import { captureMemory } from '@/lib/data/memories'
import { findTaskById } from '@/lib/data/tasks'
import { findProjectSettings } from '@/lib/data/projects'
import { listChecklistForTasks } from '@/lib/data/board-feed'
import { captureBoardEvent } from '../auto-capture'

const BASE = { userId: 'user-1', projectId: 'proj-1', taskId: 'task-1', taskName: 'Ship feed' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'm' }, created: true } as never)
  vi.mocked(findProjectSettings).mockResolvedValue({})
  vi.mocked(findTaskById).mockResolvedValue({ id: 'task-1', description: `Board is the feed. ${'y'.repeat(600)}` } as never)
  vi.mocked(listChecklistForTasks).mockResolvedValue([
    { taskId: 'task-1', title: 'tests', state: 'checked', completed: true },
    { taskId: 'task-1', title: 'deploy', state: 'unchecked', completed: false },
  ])
})

describe('captureBoardEvent — completed enrichment', () => {
  it('carries the card notes and checklist into the completed memory', async () => {
    await captureBoardEvent({ ...BASE, action: 'completed' })

    const [, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(input.type).toBe('achievement')
    expect(input.title).toBe('completed · Ship feed')
    expect(input.bodyMd).toContain('Notes: Board is the feed.')
    expect(input.bodyMd).not.toContain('y'.repeat(450))
    expect(input.bodyMd).toContain('Checklist 1/2:')
    expect(input.bodyMd).toContain('- [x] tests')
    expect(input.bodyMd).toContain('- [ ] deploy')
    expect(input.sourceMetadata).toMatchObject({ kind: 'board_event', action: 'completed', taskId: 'task-1', hasNotes: true, checklist: { done: 1, total: 2 } })
  })

  it('flags a title-only card', async () => {
    vi.mocked(findTaskById).mockResolvedValue({ id: 'task-1', description: null } as never)
    vi.mocked(listChecklistForTasks).mockResolvedValue([])

    await captureBoardEvent({ ...BASE, action: 'completed' })

    const [, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(input.bodyMd).toContain('Title only')
    expect(input.sourceMetadata).toMatchObject({ hasNotes: false, checklist: { done: 0, total: 0 } })
  })

  it('still captures the bare event when the card read fails', async () => {
    vi.mocked(findTaskById).mockRejectedValue(new Error('db down'))

    await captureBoardEvent({ ...BASE, action: 'completed' })

    const [, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(input.bodyMd).toBe('Task **Ship feed** completed.')
  })
})

describe('captureBoardEvent — feed boards', () => {
  it.each(['moved', 'updated'] as const)('suppresses per-event %s memories on a feed board', async (action) => {
    vi.mocked(findProjectSettings).mockResolvedValue({ kairosFeed: 'daily' })

    await captureBoardEvent({ ...BASE, action })

    expect(captureMemory).not.toHaveBeenCalled()
  })

  it.each(['created', 'completed', 'deleted'] as const)('keeps %s memories on a feed board', async (action) => {
    vi.mocked(findProjectSettings).mockResolvedValue({ kairosFeed: 'weekly' })

    await captureBoardEvent({ ...BASE, action })

    expect(captureMemory).toHaveBeenCalledOnce()
  })

  it('keeps moved memories on a non-feed board', async () => {
    await captureBoardEvent({ ...BASE, action: 'moved', metadata: { toColumnId: 'c2' } })

    expect(captureMemory).toHaveBeenCalledOnce()
    expect(findTaskById).not.toHaveBeenCalled()
  })
})

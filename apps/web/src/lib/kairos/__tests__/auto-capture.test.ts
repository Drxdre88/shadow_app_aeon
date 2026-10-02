import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjectFeedInfo: vi.fn() }))
vi.mock('@/lib/data/board-feed', () => ({
  listChecklistForTasks: vi.fn(),
  listBoardColumnsForFeed: vi.fn(),
  listBoardTasksByIds: vi.fn(),
  listLabelNamesForTasks: vi.fn(),
}))

import { captureMemory } from '@/lib/data/memories'
import { findTaskById } from '@/lib/data/tasks'
import { findProjectFeedInfo } from '@/lib/data/projects'
import { listBoardColumnsForFeed, listBoardTasksByIds, listChecklistForTasks, listLabelNamesForTasks } from '@/lib/data/board-feed'
import { captureBoardEvent } from '../auto-capture'
import { originKindOf } from '../origin'

const BASE = { userId: 'user-1', projectId: 'proj-1', taskId: 'task-1', taskName: 'Ship feed' }

function project(settings: Record<string, unknown> = {}, userId = 'user-1') {
  return { id: 'proj-1', userId, name: 'AS Sprint', dominionId: 'dom-1', settings }
}

const DONE_ROW = {
  id: 'task-1',
  name: 'Ship feed',
  description: 'Board is the feed.',
  status: 'done',
  columnId: 'col-done',
  createdAt: new Date('2026-09-28T09:00:00.000Z'),
  updatedAt: new Date('2026-10-02T09:00:00.000Z'),
  startedAt: new Date('2026-09-29T09:00:00.000Z'),
  completedAt: new Date('2026-10-02T09:00:00.000Z'),
  archivedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'm' }, created: true } as never)
  vi.mocked(findProjectFeedInfo).mockResolvedValue(project())
  vi.mocked(listBoardColumnsForFeed).mockResolvedValue([
    { id: 'col-live', name: 'Live', orderIndex: 0 },
    { id: 'col-done', name: 'Done', orderIndex: 1 },
    { id: 'col-vault', name: ' Vault ', orderIndex: 2 },
  ])
  vi.mocked(listBoardTasksByIds).mockResolvedValue([DONE_ROW])
  vi.mocked(listLabelNamesForTasks).mockResolvedValue([{ taskId: 'task-1', name: 'kairos' }])
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
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))

    await captureBoardEvent({ ...BASE, action })

    expect(captureMemory).not.toHaveBeenCalled()
  })

  it.each(['created', 'deleted'] as const)('keeps %s memories on a feed board', async (action) => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'weekly' }))

    await captureBoardEvent({ ...BASE, action })

    expect(captureMemory).toHaveBeenCalledOnce()
    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_event' })
  })

  it('keeps moved memories on a non-feed board', async () => {
    await captureBoardEvent({ ...BASE, action: 'moved', metadata: { toColumnId: 'c2' } })

    expect(captureMemory).toHaveBeenCalledOnce()
    expect(findTaskById).not.toHaveBeenCalled()
  })
})

describe('captureBoardEvent — watched boards capture finished cards the same day', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T10:00:00.000Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it.each(['daily', 'weekly'])('writes one agentic board_card_done memory on a %s board', async (feed) => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: feed }))

    await captureBoardEvent({ ...BASE, action: 'completed' })

    expect(captureMemory).toHaveBeenCalledOnce()
    const [userId, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(userId).toBe('user-1')
    expect(input).toMatchObject({
      type: 'achievement',
      streamClass: 'agentic',
      source: 'system',
      projectId: 'proj-1',
      taskId: 'task-1',
      dominionId: 'dom-1',
      summary: 'Finished "Ship feed" on AS Sprint · 3d · checklist 1/2',
    })
    expect(input.sourceMetadata).toMatchObject({
      kind: 'board_card_done',
      externalId: 'board-done:task-1:2026-10-02',
      cardTitle: 'Ship feed',
      daysTaken: 3,
      checklist: { done: 1, total: 2 },
    })
    expect(input.bodyMd).toContain('Notes: Board is the feed.')
    expect(input.bodyMd).toContain('labels: kairos')
    expect(input.bodyMd).toContain('- [x] tests')
    expect(originKindOf({ source: input.source, sourceMetadata: input.sourceMetadata })).toBe('activity')
  })

  it('is idempotent per card per day: a repeat completion reuses the same externalId', async () => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))

    await captureBoardEvent({ ...BASE, action: 'completed' })
    await captureBoardEvent({ ...BASE, action: 'completed', metadata: { via: 'drag' } })

    const ids = vi.mocked(captureMemory).mock.calls.map(([, input]) => input.sourceMetadata?.externalId)
    expect(ids).toEqual(['board-done:task-1:2026-10-02', 'board-done:task-1:2026-10-02'])
  })

  it.each(['col-done', 'col-vault'])('captures a move into the %s column that did not complete the card', async (toColumnId) => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))
    vi.mocked(listBoardTasksByIds).mockResolvedValue([{ ...DONE_ROW, status: 'in-progress', completedAt: null }])

    await captureBoardEvent({ ...BASE, action: 'moved', metadata: { toColumnId } })

    expect(captureMemory).toHaveBeenCalledOnce()
    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_card_done', daysTaken: null })
  })

  it('leaves a drag into Done to the completed event (one writer, no duplicate)', async () => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))

    await captureBoardEvent({ ...BASE, action: 'moved', metadata: { toColumnId: 'col-done' } })

    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('ignores moves into other columns', async () => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))

    await captureBoardEvent({ ...BASE, action: 'moved', metadata: { toColumnId: 'col-live' } })

    expect(listBoardTasksByIds).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it("keeps the plain board_event when a teammate finishes a card on the owner's watched board", async () => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }, 'owner-2'))

    await captureBoardEvent({ ...BASE, action: 'completed' })

    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_event' })
  })

  it('keeps the plain board_event on a board that is not watched', async () => {
    await captureBoardEvent({ ...BASE, action: 'completed' })

    expect(listBoardTasksByIds).not.toHaveBeenCalled()
    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_event' })
  })

  it('never throws: a failed card read is logged and falls back to the plain event', async () => {
    vi.mocked(findProjectFeedInfo).mockResolvedValue(project({ kairosFeed: 'daily' }))
    vi.mocked(listBoardTasksByIds).mockRejectedValue(new Error('db down'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(captureBoardEvent({ ...BASE, action: 'completed' })).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledOnce()
    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_event' })
    log.mockRestore()
  })

  it('degrades to the plain path when the project read fails', async () => {
    vi.mocked(findProjectFeedInfo).mockRejectedValue(new Error('db down'))

    await captureBoardEvent({ ...BASE, action: 'completed' })

    expect(vi.mocked(captureMemory).mock.calls[0]![1].sourceMetadata).toMatchObject({ kind: 'board_event' })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/data/board-feed', () => ({
  listBoardColumnsForFeed: vi.fn(),
  listBoardTasksActiveBetween: vi.fn(),
  listBoardTasksByIds: vi.fn(),
  listChecklistForTasks: vi.fn(),
  listLabelNamesForTasks: vi.fn(),
  listLiveBoardTasks: vi.fn(),
  listTaskMoveEvents: vi.fn(),
  listVaultedBetween: vi.fn(),
}))

import { captureMemory } from '@/lib/data/memories'
import {
  listBoardColumnsForFeed,
  listBoardTasksActiveBetween,
  listBoardTasksByIds,
  listChecklistForTasks,
  listLabelNamesForTasks,
  listLiveBoardTasks,
  listTaskMoveEvents,
  listVaultedBetween,
  type FeedTaskRow,
} from '@/lib/data/board-feed'
import { runBoardFeedForProject } from '../board-feed'

const USER = 'user-1'
const PROJECT = { id: 'proj-1', name: 'AS Sprint', dominionId: 'dom-1' }
const NOW = new Date('2026-09-30T23:00:00.000Z') // Wednesday
const MONDAY = new Date('2026-09-28T23:00:00.000Z')
const HOUR = 3_600_000

function task(overrides: Partial<FeedTaskRow> = {}): FeedTaskRow {
  return {
    id: 'task-1',
    name: 'Card',
    description: null,
    status: 'todo',
    columnId: 'col-todo',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listBoardColumnsForFeed).mockResolvedValue([
    { id: 'col-todo', name: 'Depot', orderIndex: 0 },
    { id: 'col-live', name: 'Live', orderIndex: 1 },
    { id: 'col-done', name: 'Done', orderIndex: 2 },
  ])
  vi.mocked(listBoardTasksActiveBetween).mockResolvedValue([])
  vi.mocked(listBoardTasksByIds).mockResolvedValue([])
  vi.mocked(listChecklistForTasks).mockResolvedValue([])
  vi.mocked(listLabelNamesForTasks).mockResolvedValue([])
  vi.mocked(listLiveBoardTasks).mockResolvedValue([])
  vi.mocked(listTaskMoveEvents).mockResolvedValue([])
  vi.mocked(listVaultedBetween).mockResolvedValue([])
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'mem-1' }, created: true } as never)
})

describe('daily board page', () => {
  it('writes nothing on a quiet day', async () => {
    const result = await runBoardFeedForProject(USER, PROJECT, 'daily', NOW)

    expect(result).toEqual({ mode: 'daily', status: 'skipped', reason: 'quiet_day' })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('assembles finished (board + vault), started and created into one durable page', async () => {
    vi.mocked(listBoardTasksActiveBetween).mockResolvedValue([
      task({
        id: 'done-1', name: 'Ship feed', status: 'done', description: 'Board becomes the main feed',
        startedAt: new Date('2026-09-27T23:00:00.000Z'), completedAt: new Date(NOW.getTime() - 2 * HOUR),
      }),
      task({ id: 'done-thin', name: 'Deploy', status: 'done', completedAt: new Date(NOW.getTime() - HOUR) }),
      task({ id: 'new-1', name: 'Plan Q4', createdAt: new Date(NOW.getTime() - 5 * HOUR) }),
      task({ id: 'start-1', name: 'Refactor inbox', columnId: 'col-live', startedAt: new Date(NOW.getTime() - 3 * HOUR) }),
    ])
    vi.mocked(listTaskMoveEvents).mockResolvedValue([
      { taskId: 'moved-1', taskName: 'Old card', metadata: { toColumnId: 'col-live' }, createdAt: new Date(NOW.getTime() - HOUR) },
      { taskId: 'new-1', taskName: 'Plan Q4', metadata: { toColumnId: 'col-live' }, createdAt: new Date(NOW.getTime() - HOUR) },
    ])
    vi.mocked(listVaultedBetween).mockResolvedValue([{
      id: 'vault-1', originalTaskId: 'orig-1', name: 'Fix login', description: null, columnName: 'Done',
      daysTaken: 2, labelSnapshot: [{ name: 'bug', color: 'red' }], checklistSnapshot: {},
      archivedAt: new Date(NOW.getTime() - 30 * 60_000), completedAt: null,
    }])
    vi.mocked(listChecklistForTasks).mockResolvedValue([
      { taskId: 'done-1', title: 'write tests', state: 'checked', completed: true },
      { taskId: 'done-1', title: 'deploy', state: 'unchecked', completed: false },
    ])
    vi.mocked(listLabelNamesForTasks).mockResolvedValue([{ taskId: 'done-1', name: 'kairos' }])

    const result = await runBoardFeedForProject(USER, PROJECT, 'daily', NOW)

    expect(result).toEqual({ mode: 'daily', status: 'created', externalId: 'board-day:proj-1:2026-09-30' })
    expect(listBoardTasksActiveBetween).toHaveBeenCalledWith('proj-1', new Date(NOW.getTime() - 24 * HOUR), NOW)
    const [, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(input).toMatchObject({
      title: '2026-09-30 · AS Sprint · board day',
      type: 'achievement',
      streamClass: 'agentic',
      source: 'cron',
      projectId: 'proj-1',
      dominionId: 'dom-1',
    })
    expect(input.sourceMetadata).toEqual({
      externalId: 'board-day:proj-1:2026-09-30',
      kind: 'board_day',
      projectId: 'proj-1',
      date: '2026-09-30',
      finished: [
        { vaultId: 'vault-1', title: 'Fix login', hasNotes: false },
        { taskId: 'done-thin', title: 'Deploy', hasNotes: false },
        { taskId: 'done-1', title: 'Ship feed', hasNotes: true },
      ],
      thinCards: [
        { vaultId: 'vault-1', title: 'Fix login' },
        { taskId: 'done-thin', title: 'Deploy' },
      ],
    })
    expect(input.bodyMd).toContain('**Ship feed** · checklist 1/2 · labels: kairos · 3d')
    expect(input.bodyMd).toContain('**Fix login** · labels: bug · 2d')
    expect(input.bodyMd).toContain('- Old card → Live')
    expect(input.bodyMd).toContain('- Refactor inbox → Live')
    // A card created today and moved is intent, not a start.
    expect(input.bodyMd).not.toContain('- Plan Q4 → Live')
    expect(input.bodyMd).toContain('**Created — intent (1)**')
  })

  it('reports an existing page when the externalId already exists', async () => {
    vi.mocked(listBoardTasksActiveBetween).mockResolvedValue([
      task({ id: 'new-1', name: 'Plan', createdAt: new Date(NOW.getTime() - HOUR) }),
    ])
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'mem-1' }, created: false } as never)

    await expect(runBoardFeedForProject(USER, PROJECT, 'daily', NOW)).resolves.toMatchObject({ status: 'existing' })
  })
})

describe('weekly milestone page', () => {
  it('only runs on Mondays', async () => {
    const result = await runBoardFeedForProject(USER, PROJECT, 'weekly', NOW)
    expect(result).toEqual({ mode: 'weekly', status: 'skipped', reason: 'not_monday' })
    expect(listLiveBoardTasks).not.toHaveBeenCalled()
  })

  it('writes the week page with columns, changes and stale cards', async () => {
    vi.mocked(listLiveBoardTasks).mockResolvedValue([
      task({ id: 'm1', name: 'Release 2.0', columnId: 'col-live', description: 'Team cut-over', updatedAt: new Date(MONDAY.getTime() - HOUR) }),
      task({ id: 'm2', name: 'Old epic', columnId: 'col-todo', updatedAt: new Date('2026-08-01T00:00:00.000Z') }),
      task({ id: 'm3', name: 'Kick-off', columnId: 'col-todo', createdAt: new Date(MONDAY.getTime() - 2 * 24 * HOUR), updatedAt: MONDAY }),
    ])

    const result = await runBoardFeedForProject(USER, { ...PROJECT, name: 'STP Sprint' }, 'weekly', MONDAY)

    expect(result).toEqual({ mode: 'weekly', status: 'created', externalId: 'board-week:proj-1:2026-W40' })
    const [, input] = vi.mocked(captureMemory).mock.calls[0]!
    expect(input).toMatchObject({ type: 'achievement', streamClass: 'agentic', title: '2026-W40 · STP Sprint · board week' })
    expect(input.sourceMetadata).toMatchObject({ kind: 'board_week', isoWeek: '2026-W40', counts: { live: 3, created: 1, untouched: 1 } })
    expect(input.bodyMd).toContain('- **Release 2.0** — Team cut-over')
    expect(input.bodyMd).toContain('- Added: Kick-off')
    expect(input.bodyMd).toContain('- Old epic (Depot) · 58d')
  })
})

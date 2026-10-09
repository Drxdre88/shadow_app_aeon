import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ai-done', () => ({ listAiDoneBoards: vi.fn(), listAiDoneCitedSessionIds: vi.fn(), findTaskIdsOnBoard: vi.fn(), listAiDoneFinished: vi.fn(async () => []) }))
vi.mock('@/lib/data/board-feed', () => ({ listChecklistForTasks: vi.fn(async () => []), listLabelNamesForTasks: vi.fn(async () => []) }))
vi.mock('@/lib/data/card-triage', () => ({ listTriagePool: vi.fn(async () => []) }))
vi.mock('@/lib/data/dominions', () => ({ listReposForUser: vi.fn(), findDominionsByUser: vi.fn() }))
vi.mock('@/lib/data/labels', () => ({ findLabels: vi.fn(async () => []) }))
vi.mock('@/lib/data/repo-memory', () => ({ listSessionSummariesBetween: vi.fn(), listRepoGitDigestsBetween: vi.fn(async () => []) }))

import { findTaskIdsOnBoard, listAiDoneBoards, listAiDoneCitedSessionIds, listAiDoneFinished } from '@/lib/data/ai-done'
import { listChecklistForTasks, listLabelNamesForTasks } from '@/lib/data/board-feed'
import { listTriagePool } from '@/lib/data/card-triage'
import { findDominionsByUser, listReposForUser } from '@/lib/data/dominions'
import { listSessionSummariesBetween, type RepoSessionRow } from '@/lib/data/repo-memory'
import { coreRepoIndex, coreSlug, gatherAiDone } from '../gather'

const USER = 'u-1'
const NOW = new Date('2026-10-08T15:30:00Z')

const session = (id: string, repo: string, over: Partial<RepoSessionRow> = {}): RepoSessionRow => ({
  id, repo, title: `T ${id}`, summary: `did ${id}`, body: '', client: 'claude', createdAt: NOW, facts: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAiDoneBoards).mockResolvedValue([{ id: 'p-1', name: 'AI Mission Control' }])
  vi.mocked(listReposForUser).mockResolvedValue([{ dominionId: 'd-1', repoSlug: 'aeon' }, { dominionId: 'd-2', repoSlug: 'shadow_app_triad' }])
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: 'd-1', name: 'KAIROS' }, { id: 'd-2', name: 'Shadow Apps' }] as never)
  vi.mocked(listSessionSummariesBetween).mockResolvedValue([
    session('m-3', 'shadow_app_triad'),
    session('m-2', 'shadow_app_swarm'),
    session('m-1', 'shadow_app_aeon', { taskId: 't-on-board' }),
    session('m-0', 'shadow_app_aeon'),
  ])
  vi.mocked(findTaskIdsOnBoard).mockResolvedValue(new Set(['t-on-board']))
  vi.mocked(listAiDoneCitedSessionIds).mockResolvedValue(new Set())
})

describe('core repos', () => {
  it('resolves labels, folders and paths to one slug on both sides', () => {
    expect(coreSlug('repo:aeon')).toBe('shadow_app_aeon')
    expect(coreSlug('C:/dev_26/shadow_app_aeon')).toBe('shadow_app_aeon')
    expect(coreSlug('dev_26')).toBeNull()
    expect(coreRepoIndex([{ dominionId: 'd-1', repoSlug: 'kairos' }, { dominionId: 'd-2', repoSlug: 'aeon' }], [{ id: 'd-1', name: 'KAIROS' }]))
      .toEqual(new Map([['shadow_app_aeon', 'KAIROS']]))
  })
})

describe('gatherAiDone', () => {
  it('reads today (London) and keeps every repo\'s sessions not already on the board, oldest first', async () => {
    const out = await gatherAiDone(USER, NOW)
    expect(listSessionSummariesBetween).toHaveBeenCalledWith(USER, new Date('2026-10-07T23:00:00Z'), NOW)
    expect(findTaskIdsOnBoard).toHaveBeenCalledWith('p-1', ['t-on-board'])
    expect(out?.day).toBe('2026-10-08')
    expect(out?.sessions.map((s) => [s.h, s.id, s.repo, s.dominion])).toEqual([
      ['S1', 'm-0', 'shadow_app_aeon', 'KAIROS'],
      ['S2', 'm-2', 'shadow_app_swarm', null],
      ['S3', 'm-3', 'shadow_app_triad', 'Shadow Apps'],
    ])
    expect(out?.boards).toMatchObject([{ h: 'B1', projectId: 'p-1', sessions: ['S1', 'S2', 'S3'] }])
  })

  it('drops sessions an earlier AI DONE card already cites', async () => {
    vi.mocked(listAiDoneCitedSessionIds).mockResolvedValue(new Set(['m-0']))
    const out = await gatherAiDone(USER, NOW)
    expect(out?.sessions.map((s) => s.id)).toEqual(['m-2', 'm-3'])
  })

  it('skips sessions with no usable repo', async () => {
    vi.mocked(listSessionSummariesBetween).mockResolvedValueOnce([session('m-9', 'dev_26'), session('m-8', '')])
    expect(await gatherAiDone(USER, NOW)).toBeNull()
  })

  it('shows the owner\'s finished work (Done column and vault, 90 days) as F handles and dedups their titles', async () => {
    vi.mocked(listAiDoneFinished).mockResolvedValueOnce([
      { title: 'Swarm Data Rebuild', checklist: ['EPEX SFTP'], vaulted: false },
      { title: 'Paper Researcher', checklist: [], vaulted: true },
    ])
    const out = await gatherAiDone(USER, NOW)
    expect(listAiDoneFinished).toHaveBeenCalledWith('p-1', new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000))
    expect(out?.boards[0]?.finished).toEqual([
      { h: 'F1', title: 'Swarm Data Rebuild', done: true, labels: [], checklist: ['EPEX SFTP'] },
      { h: 'F2', title: 'Paper Researcher', done: true, labels: ['vault'], checklist: [] },
    ])
    expect(out?.boards[0]?.titles).toEqual(['Swarm Data Rebuild', 'Paper Researcher'])
  })

  it('gives each board its cards with labels and checklist text, and every title for dedup', async () => {
    vi.mocked(listTriagePool).mockResolvedValue([
      { id: 'c-1', name: 'Shadow Auth', description: null, status: 'todo', completedAt: null },
      { id: 'c-2', name: 'Triad Polish', description: null, status: 'done', completedAt: NOW },
    ])
    vi.mocked(listChecklistForTasks).mockResolvedValue([{ taskId: 'c-2', title: 'Light mode', state: 'checked', completed: true }])
    vi.mocked(listLabelNamesForTasks).mockResolvedValue([{ taskId: 'c-1', name: 'repo:aeon' }])
    const out = await gatherAiDone(USER, NOW)
    expect(out?.boards[0]?.titles).toEqual(['Shadow Auth', 'Triad Polish'])
    expect(out?.boards[0]?.cards).toEqual([
      { h: 'E1', title: 'Shadow Auth', done: false, labels: ['repo:aeon'], checklist: [] },
      { h: 'E2', title: 'Triad Polish', done: true, labels: [], checklist: ['Light mode'] },
    ])
  })

  it('returns null with no switched-on board or nothing new for any board', async () => {
    vi.mocked(listAiDoneBoards).mockResolvedValueOnce([])
    expect(await gatherAiDone(USER, NOW)).toBeNull()
    expect(listSessionSummariesBetween).not.toHaveBeenCalled()
    vi.mocked(listAiDoneCitedSessionIds).mockResolvedValueOnce(new Set(['m-0', 'm-2', 'm-3']))
    expect(await gatherAiDone(USER, NOW)).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ask_mine × one mind (spec_one_mind): the owner's last-24h statements ride
// in the signal bundle so Kairos doesn't mine a question just answered.
// Owner speaker only — agent / Kairos entries never count as the owner's words.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  listOpenKairosAsks: vi.fn(async () => []),
  listKairosReflectionStaleness: vi.fn(async () => []),
  listRecentKairosAsks: vi.fn(async () => []),
}))
vi.mock('@/lib/data/board-signals', () => ({
  listStaleTasks: vi.fn(async () => []),
  listRecentlyCompletedTasks: vi.fn(async () => []),
  listRecentlyCreatedTasks: vi.fn(async () => []),
}))
vi.mock('@/lib/data/board-feed', () => ({ listBoardDayPages: vi.fn(async () => []) }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(async () => []) }))
vi.mock('@/lib/data/thinking-jobs', () => ({ isJobDone: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/engagement', () => ({
  getConversationState: vi.fn(async () => ({ lastOutbound: null, replied: false, awaitingReply: false, replyRate7d: 0 })),
}))
vi.mock('@/lib/kairos/aether', () => ({
  fetchAetherInputs: vi.fn(async () => ({
    cortexSnapshots: [{ id: 'cortex-1', dominionId: 'd1', dominionName: 'Kairos', dominionColor: null, createdAt: new Date(), visionAnchor: null, currentState: [], driftSignals: ['Atlas has not moved in 21 days.'] }],
    prior: null,
  })),
}))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../today', () => ({ loadTodayDigest: vi.fn() }))

import { loadTodayDigest } from '../today'
import { loadOwnerTodayForAskMine } from '../ask-mine-today'
import { runAskMineForUser } from '../ask-mine'

const USER = 'user-1'
const DATE = '2026-10-03'
const NOW = new Date(`${DATE}T04:30:00.000Z`)

const digest = {
  from: '2026-10-02T04:30:00.000Z',
  to: '2026-10-03T04:30:00.000Z',
  entries: [
    { at: '2026-10-02T10:00:00.000Z', channel: 'telegram', type: 'answered', speaker: 'owner', relayed: false, text: 'Q12 (Which ships first?): Aeon first.' },
    { at: '2026-10-02T11:00:00.000Z', channel: 'web', type: 'replied', speaker: 'kairos', relayed: false, text: 'Got it.' },
    { at: '2026-10-02T12:00:00.000Z', channel: 'triad', type: 'said', speaker: 'agent', relayed: true, text: 'relayed: owner wants X' },
    { at: '2026-10-02T13:00:00.000Z', channel: 'inbox', type: 'decided', speaker: 'owner', relayed: false, text: 'Approved: Why do boards drift?' },
  ],
} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadOwnerTodayForAskMine', () => {
  it('keeps only the owner\'s own statements and decisions', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValue(digest)

    const signal = await loadOwnerTodayForAskMine(USER)

    expect(loadTodayDigest).toHaveBeenCalledWith(USER, expect.objectContaining({ hours: 24 }))
    expect(signal?.statements).toEqual([
      '2026-10-02 10:00 telegram answered: Q12 (Which ships first?): Aeon first.',
      '2026-10-02 13:00 inbox decided: Approved: Why do boards drift?',
    ])
  })

  it('is null when the log is off/unreadable or has no owner words', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValueOnce(null)
    expect(await loadOwnerTodayForAskMine(USER)).toBeNull()
    vi.mocked(loadTodayDigest).mockResolvedValueOnce({ from: '', to: '', entries: [] })
    expect(await loadOwnerTodayForAskMine(USER)).toBeNull()
  })
})

describe('ask_mine model input', () => {
  it('carries the owner\'s statements in the signal bundle with a do-not-re-ask note', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValue(digest)

    const res = await runAskMineForUser(USER, { date: DATE, now: NOW, dryRun: true })

    expect(res.status).toBe('dry_run')
    const prompt = (res as { modelInput: { prompt: string } }).modelInput.prompt
    expect(prompt).toContain('"ownerSaidToday"')
    expect(prompt).toContain('Aeon first.')
    expect(prompt).toContain('Do not ask anything these already answer or decide.')
    expect(prompt).not.toContain('relayed: owner wants X')
  })

  it('omits the field on a quiet day', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValue(null)
    const res = await runAskMineForUser(USER, { date: DATE, now: NOW, dryRun: true })
    expect((res as { modelInput: { prompt: string } }).modelInput.prompt).not.toContain('ownerSaidToday')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  listOpenKairosAsks: vi.fn(async () => []),
  listKairosReflectionStaleness: vi.fn(async () => []),
  listRecentKairosAsks: vi.fn(async () => []),
}))
vi.mock('@/lib/data/board-signals', () => ({
  listStaleTasks: vi.fn(async () => [{ taskId: 'task-1', name: 'Ship Atlas', projectId: 'p', projectName: 'Aeon', columnName: 'Live', priority: 'high', ageDays: 24 }]),
  listRecentlyCompletedTasks: vi.fn(async () => []),
  listRecentlyCreatedTasks: vi.fn(async () => []),
}))
vi.mock('@/lib/data/board-feed', () => ({ listBoardDayPages: vi.fn(async () => []) }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(async () => []) }))
vi.mock('@/lib/data/thinking-jobs', () => ({ isJobDone: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/engagement', () => ({ getConversationState: vi.fn(async () => ({ awaitingReply: false })) }))
vi.mock('@/lib/kairos/aether', () => ({ fetchAetherInputs: vi.fn(async () => ({ cortexSnapshots: [], topReflections: [], archetypes: [], prior: null, todaySoFar: null })) }))
vi.mock('@/lib/kairos/ask-mine-today', () => ({ loadOwnerTodayForAskMine: vi.fn(async () => null) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class extends Error {},
  AiCredentialDecryptError: class extends Error {},
}))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-surprise', () => ({ mutateKairosSurprise: vi.fn(async () => null), readKairosSurprise: vi.fn() }))

import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { mutateKairosSurprise } from '@/lib/data/kairos-surprise'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import { runAskMineForUser, selectAskMineCandidate } from '../ask-mine'
import type { AskMineCandidate } from '../ask-mine-prompt'

const DATE = '2026-07-19'
const NOW = new Date(`${DATE}T04:30:00.000Z`)

const candidate = (dominionId: string, leverage: number, n: number): AskMineCandidate => ({
  question: `Which call in area ${n} should change first?`,
  kind: 'decision',
  dominionId,
  sourceMemoryIds: [`m-${n}`],
  leverage,
  rationale: 'test',
})

// Six calls in one Dominion: three confident misses, then three hits.
function improving(dominionId: string): KairosPrediction[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`, seq: i + 1, claim: 'x'.repeat(30), probability: 0.8,
    dueDate: '2026-07-10', topic: 'delivery', dominionId, basisIds: [], check: { kind: 'owner_verdict' },
    source: { kind: 'weekly_review', jobId: 'j' }, createdAt: '2026-07-01T00:00:00.000Z',
    status: i < 3 ? 'wrong' : 'right', settledAt: `2026-07-1${i}T00:00:00.000Z`,
  }) as KairosPrediction)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_CURIOSITY_LP
})
afterEach(() => { delete process.env.KAIROS_CURIOSITY_LP })

describe('selectAskMineCandidate with learning progress', () => {
  const near = [candidate('d-flat', 0.82, 1), candidate('d-learning', 0.8, 2)]

  it('no bias → leverage order (unchanged)', () => {
    expect(selectAskMineCandidate(near, [], DATE)?.dominionId).toBe('d-flat')
  })

  it('the LP bias reorders a near-tie toward the improving area', () => {
    const bias = new Map([['d-learning', 1]])
    expect(selectAskMineCandidate(near, [], DATE, bias)?.dominionId).toBe('d-learning')
  })

  it('never overturns a clear leverage gap', () => {
    const far = [candidate('d-flat', 0.95, 1), candidate('d-learning', 0.6, 2)]
    expect(selectAskMineCandidate(far, [], DATE, new Map([['d-learning', 1]]))?.dominionId).toBe('d-flat')
  })
})

describe('ask_mine prompt and KAIROS_CURIOSITY_LP', () => {
  const prompt = async () => {
    const res = await runAskMineForUser('u1', { date: DATE, now: NOW, dryRun: true })
    if (res.status !== 'dry_run') throw new Error(res.status)
    return res.modelInput
  }

  it('off: no LP read, no ledger write, prompt has no learningProgress', async () => {
    const input = await prompt()
    expect(input.prompt).not.toContain('learningProgress')
    expect(readKairosPredictions).not.toHaveBeenCalled()
    expect(mutateKairosSurprise).not.toHaveBeenCalled()
  })

  it('observe: computes and stores LP, prompt byte-identical to off', async () => {
    const off = await prompt()
    vi.mocked(readKairosPredictions).mockResolvedValue({ v: 1, nextSeq: 7, open: [], closed: improving('d-learning') })
    process.env.KAIROS_CURIOSITY_LP = 'observe'
    const observed = await prompt()
    expect(observed).toEqual(off)
    expect(mutateKairosSurprise).toHaveBeenCalledTimes(1)
  })

  it('on: the user prompt carries the top areas; the system prompt stays static', async () => {
    const off = await prompt()
    vi.mocked(readKairosPredictions).mockResolvedValue({ v: 1, nextSeq: 7, open: [], closed: improving('d-learning') })
    process.env.KAIROS_CURIOSITY_LP = '1'
    const on = await prompt()
    expect(on.system).toBe(off.system)
    expect(on.prompt).toContain('"learningProgress"')
    expect(on.prompt).toContain('"dominionId": "d-learning"')
  })
})

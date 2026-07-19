import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  listKairosReflectionStaleness: vi.fn(),
  listRecentKairosAsks: vi.fn(),
}))

vi.mock('@/lib/data/board-signals', () => ({
  listStaleTasks: vi.fn(),
  listRecentlyCompletedTasks: vi.fn(),
  listRecentlyCreatedTasks: vi.fn(),
}))

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
}))

vi.mock('@/lib/kairos/engagement', () => ({
  getConversationState: vi.fn(),
}))

vi.mock('@/lib/kairos/aether', () => ({
  fetchAetherInputs: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))

import { getProviderForTask } from '@/lib/ai/route-task'
import {
  createKairosAskMemory,
  getPendingKairosAsk,
  listKairosReflectionStaleness,
  listRecentKairosAsks,
  type KairosAskRow,
} from '@/lib/data/ask'
import {
  listRecentlyCompletedTasks,
  listRecentlyCreatedTasks,
  listStaleTasks,
} from '@/lib/data/board-signals'
import { findDominionsByUser } from '@/lib/data/dominions'
import { fetchAetherInputs } from '@/lib/kairos/aether'
import { getConversationState } from '@/lib/kairos/engagement'
import {
  parseAskMineResponse,
  runAskMineForUser,
  selectAskMineCandidate,
} from '../ask-mine'
import type { AskMineCandidate } from '../ask-mine-prompt'

const USER_ID = 'user-1'
const DOMINION_ID = 'dominion-1'
const DATE = '2026-07-19'
const NOW = new Date(`${DATE}T04:30:00.000Z`)

function candidate(overrides: Partial<AskMineCandidate> = {}): AskMineCandidate {
  return {
    question: 'Should Atlas ship before the mobile work resumes?',
    kind: 'decision',
    dominionId: DOMINION_ID,
    sourceMemoryIds: ['memory-1'],
    leverage: 0.88,
    rationale: 'Atlas gates two active workstreams.',
    ...overrides,
  }
}

function recentAsk(overrides: Partial<KairosAskRow> = {}): KairosAskRow {
  return {
    id: 'ask-old',
    title: 'Which Atlas route should ship first?',
    summary: null,
    dominionId: DOMINION_ID,
    createdAt: new Date('2026-07-18T04:30:00.000Z'),
    kairosAsk: {
      status: 'answered',
      aetherMemoryId: 'aether-old',
      sourceThoughtId: null,
      sourceMemoryIds: ['old-memory'],
      dominionId: DOMINION_ID,
      askedAt: '2026-07-18T04:30:00.000Z',
    },
    askMine: {
      date: '2026-07-18',
      kind: 'decision',
      sourceMemoryIds: ['old-memory'],
      leverage: 0.8,
    },
    ...overrides,
  }
}

function providerResponse(candidates: unknown[], critiques: unknown[]) {
  return {
    text: JSON.stringify({ candidates, selfCritique: critiques }),
    providerId: 'byok',
    modelId: 'standard-model',
  }
}

function routedProvider(ask: ReturnType<typeof vi.fn>): Awaited<ReturnType<typeof getProviderForTask>> {
  return {
    decision: {
      providerId: 'byok',
      modelId: null,
      tier: 'standard',
      source: 'default',
    },
    provider: {
      providerId: 'byok',
      modelId: 'standard-model',
      ask,
      stream: async function* () {},
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
  vi.mocked(getConversationState).mockResolvedValue({
    lastOutbound: null,
    replied: false,
    awaitingReply: false,
    replyRate7d: 0,
  })
  vi.mocked(listRecentKairosAsks).mockResolvedValue([])
  vi.mocked(listKairosReflectionStaleness).mockResolvedValue([{
    dominionId: DOMINION_ID,
    dominionName: 'Kairos',
    lastReflectedAt: new Date('2026-07-10T00:00:00.000Z'),
  }])
  vi.mocked(findDominionsByUser).mockResolvedValue([{
    id: DOMINION_ID,
    name: 'Kairos',
    archivedAt: null,
  }] as Awaited<ReturnType<typeof findDominionsByUser>>)
  vi.mocked(fetchAetherInputs).mockResolvedValue({
    cortexSnapshots: [{
      id: 'cortex-1',
      dominionId: DOMINION_ID,
      dominionName: 'Kairos',
      dominionColor: null,
      createdAt: NOW,
      visionAnchor: null,
      currentState: [],
      driftSignals: ['Atlas has not moved in 21 days.'],
    }],
    topReflections: [{
      id: 'reflection-1',
      dominionId: DOMINION_ID,
      dominionName: 'Kairos',
      title: 'Atlas intent',
      summary: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
    }],
    archetypes: [],
    prior: {
      id: 'aether-1',
      createdAt: NOW,
      payload: {
        generatedAt: NOW.toISOString(),
        coreNarrative: 'Atlas is gating the initiative engine.',
        thoughts: [{
          id: 'thought-1',
          title: 'Atlas gate',
          insight: 'Two workstreams wait on Atlas.',
          dominionId: DOMINION_ID,
          dominionName: 'Kairos',
          dominionColor: null,
          salience: 0.9,
          kind: 'question',
          sourceMemoryIds: ['memory-1'],
          ageDays: 1,
        }],
        tensions: [],
        shifts: [],
      },
    },
  })
  vi.mocked(listStaleTasks).mockResolvedValue([{
    taskId: 'task-1',
    name: 'Ship Atlas',
    projectId: 'project-1',
    projectName: 'Aeon',
    columnName: 'Live',
    priority: 'high',
    ageDays: 24,
  }])
  vi.mocked(listRecentlyCompletedTasks).mockResolvedValue([])
  vi.mocked(listRecentlyCreatedTasks).mockResolvedValue([])
  vi.mocked(createKairosAskMemory).mockResolvedValue('ask-new')
  vi.mocked(getProviderForTask).mockResolvedValue(routedProvider(
    vi.fn().mockResolvedValue(providerResponse(
      [candidate()],
      [{ candidateIndex: 0, clear: true, answerable: true, grounded: true, note: 'Specific and sourced.' }],
    )),
  ))
})

describe('ask mining', () => {
  it('validates candidates and their same-call critique before dispatch', async () => {
    const ask = vi.fn().mockResolvedValue(providerResponse(
      [
        candidate(),
        candidate({ question: 'What now?', sourceMemoryIds: ['memory-1'], leverage: 0.99 }),
        candidate({ question: 'Should the invented signal win?', sourceMemoryIds: ['invented'], leverage: 1 }),
      ],
      [
        { candidateIndex: 0, clear: true, answerable: true, grounded: true, note: 'Specific and sourced.' },
        { candidateIndex: 1, clear: false, answerable: true, grounded: true, note: 'Too vague.' },
        { candidateIndex: 2, clear: true, answerable: true, grounded: true, note: 'Claims a source.' },
      ],
    ))
    vi.mocked(getProviderForTask).mockResolvedValue(routedProvider(ask))

    const result = await runAskMineForUser(USER_ID, { date: DATE, now: NOW })

    expect(result).toMatchObject({ status: 'created', askId: 'ask-new' })
    expect(getProviderForTask).toHaveBeenCalledWith(USER_ID, {
      taskType: 'reflect',
      dominionId: null,
    })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0][0]).not.toHaveProperty('temperature')
    expect(createKairosAskMemory).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      question: candidate().question,
    }))
  })

  it('drops malformed candidates and candidates that fail self-critique', () => {
    const parsed = parseAskMineResponse(JSON.stringify({
      candidates: [candidate(), { ...candidate(), sourceMemoryIds: [] }],
      selfCritique: [
        { candidateIndex: 0, clear: true, answerable: false, grounded: true, note: 'Not answerable.' },
        { candidateIndex: 1, clear: true, answerable: true, grounded: true, note: 'Malformed source list.' },
      ],
    }))

    expect(parsed).toEqual([])
  })

  it('rotates yesterday\'s kind and Dominion, then chooses the highest eligible leverage', () => {
    const selected = selectAskMineCandidate([
      candidate({ kind: 'decision', dominionId: null, leverage: 0.99, sourceMemoryIds: ['fresh-1'] }),
      candidate({ kind: 'revival', leverage: 0.89, sourceMemoryIds: ['fresh-2'] }),
      candidate({ kind: 'premortem', leverage: 0.91, dominionId: null, sourceMemoryIds: ['fresh-3'] }),
    ], [recentAsk()], DATE)

    expect(selected?.kind).toBe('premortem')
  })

  it('allows the same Dominion on consecutive days only at leverage 0.9 or above', () => {
    const selected = selectAskMineCandidate([
      candidate({ kind: 'revival', leverage: 0.9, sourceMemoryIds: ['fresh-1'] }),
    ], [recentAsk()], DATE)

    expect(selected?.kind).toBe('revival')
  })

  it('deduplicates on either source overlap or fuzzy question-title match', () => {
    const selected = selectAskMineCandidate([
      candidate({ kind: 'revival', dominionId: null, sourceMemoryIds: ['old-memory'], leverage: 1 }),
      candidate({
        question: 'Should the Atlas route be the first thing we ship?',
        kind: 'premortem',
        dominionId: null,
        sourceMemoryIds: ['fresh-2'],
        leverage: 0.99,
      }),
      candidate({
        question: 'What fallback protects the Aether regeneration bet?',
        kind: 'premortem',
        dominionId: null,
        sourceMemoryIds: ['fresh-3'],
        leverage: 0.8,
      }),
    ], [recentAsk()], DATE)

    expect(selected?.sourceMemoryIds).toEqual(['fresh-3'])
  })

  it('short-circuits before signals or provider work when a pending ask exists', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(recentAsk({
      kairosAsk: { ...recentAsk().kairosAsk, status: 'pending' },
    }))

    const result = await runAskMineForUser(USER_ID, { date: DATE, now: NOW })

    expect(result).toMatchObject({ status: 'skipped', reason: 'pending' })
    expect(getConversationState).not.toHaveBeenCalled()
    expect(fetchAetherInputs).not.toHaveBeenCalled()
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('stamps ask-mine provenance, stable idempotency, and a 72-hour expiry', async () => {
    await runAskMineForUser(USER_ID, { date: DATE, now: NOW })

    expect(createKairosAskMemory).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      askedAt: NOW.toISOString(),
      expiresAt: '2026-07-22T04:30:00.000Z',
      externalId: `ask-mine:${DATE}:1`,
      askMine: {
        date: DATE,
        kind: 'decision',
        sourceMemoryIds: ['memory-1'],
        leverage: 0.88,
      },
    }))
  })

  it('returns the complete model input in dry-run mode without calling or writing', async () => {
    const result = await runAskMineForUser(USER_ID, { date: DATE, now: NOW, dryRun: true })

    expect(result.status).toBe('dry_run')
    expect(result).toMatchObject({ modelInput: { cacheSystem: true, maxOutputTokens: 4000 } })
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(createKairosAskMemory).not.toHaveBeenCalled()
  })
})

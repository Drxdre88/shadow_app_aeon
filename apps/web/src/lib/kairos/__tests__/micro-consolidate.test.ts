import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MICRO_CONSOLIDATE_SYSTEM_PROMPT,
  buildMicroConsolidateUserPrompt,
  type MicroConsolidateContext,
} from '../micro-consolidate-prompt'

// Pure-function prompt tests first (no DB), then a DB-mocked describe block
// mirroring cortex.test.ts / aether.test.ts's chainable-query pattern —
// db.select() calls fire in this exact order per runMicroConsolidateForDominion:
// dominion lookup -> lastDeltaWindowEnd -> todaysCortexCreatedAt -> fetchNewMemoriesSince.

describe('buildMicroConsolidateUserPrompt', () => {
  function makeCtx(overrides: Partial<MicroConsolidateContext> = {}): MicroConsolidateContext {
    return {
      dominionId: '11111111-1111-4111-8111-111111111111',
      dominionName: 'AEON',
      since: new Date('2026-07-24T09:00:00.000Z'),
      now: new Date('2026-07-24T12:00:00.000Z'),
      newMemories: [
        { title: 'Shipped micro-consolidation cron', type: 'observation', streamClass: 'agentic' },
        { title: 'Fixed generator token caps', type: 'note', streamClass: 'idea' },
      ],
      tasksCompleted: 3,
      tasksCreated: 1,
      ...overrides,
    }
  }

  it('includes the Dominion name, window, and new memory titles', () => {
    const prompt = buildMicroConsolidateUserPrompt(makeCtx())
    expect(prompt).toContain('Dominion: "AEON"')
    expect(prompt).toContain('2026-07-24T09:00:00.000Z')
    expect(prompt).toContain('2026-07-24T12:00:00.000Z')
    expect(prompt).toContain('Shipped micro-consolidation cron')
    expect(prompt).toContain('Fixed generator token caps')
  })

  it('includes board deltas', () => {
    const prompt = buildMicroConsolidateUserPrompt(makeCtx())
    expect(prompt).toContain('Tasks completed: 3')
    expect(prompt).toContain('Tasks created: 1')
  })

  it('renders "(none)" when there are no new memories', () => {
    const prompt = buildMicroConsolidateUserPrompt(makeCtx({ newMemories: [] }))
    expect(prompt).toContain('(none)')
  })

  it('escapes triple-backticks in memory titles', () => {
    const prompt = buildMicroConsolidateUserPrompt(
      makeCtx({ newMemories: [{ title: 'evil```json {"x":1}```', type: 'note', streamClass: 'idea' }] }),
    )
    expect(prompt).not.toContain('evil```json')
    expect(prompt).toContain("evil'''json")
  })
})

describe('MICRO_CONSOLIDATE_SYSTEM_PROMPT', () => {
  it('requests plain text, not JSON', () => {
    expect(MICRO_CONSOLIDATE_SYSTEM_PROMPT).toMatch(/plain text/i)
    expect(MICRO_CONSOLIDATE_SYSTEM_PROMPT).not.toContain('```json')
  })
})

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
    },
  }
})

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  // Stand-in for the real bi-temporal gate — content doesn't matter here,
  // db.select is fully mocked below and never inspects the SQL it's given.
  validAsOfNow: 'mock-valid-as-of-now',
}))

vi.mock('@/lib/data/board-signals', () => ({
  countTasksCompletedBetween: vi.fn(),
  countTasksCreatedBetween: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/data/thinking-jobs', () => ({
  isJobDone: vi.fn(async () => false),
}))

const USER_ID = 'user-1'
const DOMINION_ID = '11111111-1111-4111-8111-111111111111'

function queueDominionLookup(overrides: Partial<{ id: string; name: string; archivedAt: Date | null }> = {}) {
  selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null, ...overrides }])
}

describe('runMicroConsolidateForDominion', { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T15:22:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips below the new-memory threshold without calling the model', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')

    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt — none
    selectQueue.push([]) // todaysCortexCreatedAt — none
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows — only 2, below MIN_NEW_MEMORIES (3)
    selectQueue.push([{ total: 2 }]) // fetchNewMemoriesSince total — no truncation

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    expect(result).toEqual({
      dominionId: DOMINION_ID,
      dominionName: 'AEON',
      status: 'skipped',
      reason: 'below threshold',
      newMemoryCount: 2,
    })
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('routes the model call through taskType "delta"', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows — 3, meets threshold
    selectQueue.push([{ total: 3 }]) // fetchNewMemoriesSince total — no truncation

    vi.mocked(countTasksCompletedBetween).mockResolvedValue(1)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(2)
    const ask = vi.fn().mockResolvedValue({ text: 'A quiet but productive window.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({
      memory: { id: 'delta-mem-1' },
      created: true,
    } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    expect(getProviderForTask).toHaveBeenCalledWith(USER_ID, { taskType: 'delta', dominionId: DOMINION_ID })
    expect(result.status).toBe('created')
    expect(result.deltaMemoryId).toBe('delta-mem-1')
  })

  it('builds an hour-bucketed externalId and reports "existing" on a same-hour retry', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows
    selectQueue.push([{ total: 3 }]) // fetchNewMemoriesSince total — no truncation
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'Same-hour retry.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    // Simulates captureMemory's own externalId dedup short-circuiting on a
    // same-hour retry (created:false, returns the row written the first time).
    vi.mocked(captureMemory).mockResolvedValue({
      memory: { id: 'delta-mem-1' },
      created: false,
    } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('existing')
    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.externalId).toBe(`micro-consolidate:${DOMINION_ID}:2026-07-24T15`)
  })

  it('flags truncation in sourceMetadata when new memories exceed the LIMIT-30 fetch', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push(
      Array.from({ length: 30 }, (_, i) => ({ title: `m${i}`, type: 'note', streamClass: 'idea' })),
    ) // fetchNewMemoriesSince rows — capped at 30
    selectQueue.push([{ total: 47 }]) // fetchNewMemoriesSince total — 47 actually landed
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'A very busy window.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(result.newMemoryCount).toBe(30)
    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.truncated).toBe(true)
    expect(call.sourceMetadata.newMemoryTotal).toBe(47)
  })

  it('does not flag truncation when the total matches the fetched rows', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows
    selectQueue.push([{ total: 3 }]) // fetchNewMemoriesSince total — matches rows.length
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'A quiet window.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.truncated).toBeUndefined()
    expect(call.sourceMetadata.newMemoryTotal).toBeUndefined()
  })

  it('scopes the fetch window from lastDelta when it is later than today\'s cortex (GREATEST anchor)', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    const lastDeltaAt = new Date('2026-07-24T15:00:00.000Z')
    const cortexAt = new Date('2026-07-24T14:00:00.000Z')

    queueDominionLookup()
    selectQueue.push([{ createdAt: lastDeltaAt }]) // lastDeltaCreatedAt
    selectQueue.push([{ createdAt: cortexAt }]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows
    selectQueue.push([{ total: 3 }]) // fetchNewMemoriesSince total
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'Delta since 15:00.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.since).toBe(lastDeltaAt.toISOString())
  })

  it('scopes the fetch window from today\'s cortex when it is later than lastDelta (GREATEST anchor)', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')

    const lastDeltaAt = new Date('2026-07-24T14:00:00.000Z')
    const cortexAt = new Date('2026-07-24T15:00:00.000Z')

    queueDominionLookup()
    selectQueue.push([{ createdAt: lastDeltaAt }]) // lastDeltaCreatedAt
    selectQueue.push([{ createdAt: cortexAt }]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]) // fetchNewMemoriesSince rows
    selectQueue.push([{ total: 3 }]) // fetchNewMemoriesSince total
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'Delta since cortex.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.since).toBe(cortexAt.toISOString())
  })

  it('produces distinct externalIds across an hour-bucket rollover (:59 -> :00)', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'Rolling over.' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const newMemoryRows = [
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ]

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')

    vi.setSystemTime(new Date('2026-07-24T15:59:30.000Z'))
    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push(newMemoryRows)
    selectQueue.push([{ total: 3 }])
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    vi.setSystemTime(new Date('2026-07-24T16:00:01.000Z'))
    queueDominionLookup()
    selectQueue.push([]) // lastDeltaCreatedAt
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push(newMemoryRows)
    selectQueue.push([{ total: 3 }])
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    const firstCall = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    const secondCall = vi.mocked(captureMemory).mock.calls[1][1] as { sourceMetadata: Record<string, unknown> }
    expect(firstCall.sourceMetadata.externalId).toBe(`micro-consolidate:${DOMINION_ID}:2026-07-24T15`)
    expect(secondCall.sourceMetadata.externalId).toBe(`micro-consolidate:${DOMINION_ID}:2026-07-24T16`)
    expect(firstCall.sourceMetadata.externalId).not.toBe(secondCall.sourceMetadata.externalId)
  })

  it('skips archived Dominions', async () => {
    queueDominionLookup({ archivedAt: new Date('2026-01-01') })
    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('archived')
  })

  async function runWithAnchors(lastDelta: Date | null, cortex: Date | null) {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')
    queueDominionLookup()
    selectQueue.push(lastDelta ? [{ createdAt: lastDelta }] : [])
    selectQueue.push(cortex ? [{ createdAt: cortex }] : [])
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ])
    selectQueue.push([{ total: 3 }])
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'window' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)
    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)
    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    return call.sourceMetadata.since
  }

  it('no UTC-midnight floor: the morning run folds activity since last night\'s delta', async () => {
    // Before: since was clamped to 2026-07-25T00:00Z, dropping 21:15→24:00.
    vi.setSystemTime(new Date('2026-07-25T02:15:00.000Z'))
    const lastDeltaAt = new Date('2026-07-24T21:15:00.000Z')
    expect(await runWithAnchors(lastDeltaAt, null)).toBe(lastDeltaAt.toISOString())
  })

  it('with no prior delta and no cortex today, looks back 18h (not to UTC midnight)', async () => {
    // system time 2026-07-24T15:22Z → 18h back crosses into yesterday.
    expect(await runWithAnchors(null, null)).toBe('2026-07-23T21:22:00.000Z')
  })

  it('with no prior delta but today\'s cortex, anchors on the cortex', async () => {
    const cortexAt = new Date('2026-07-24T03:05:00.000Z')
    expect(await runWithAnchors(null, cortexAt)).toBe(cortexAt.toISOString())
  })

  it('anchors on the last delta\'s stored `until`, not its later createdAt (routine folds land after their window)', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')
    const until = '2026-07-24T14:20:00.000Z'
    queueDominionLookup()
    selectQueue.push([{ createdAt: new Date('2026-07-24T14:45:00.000Z'), until }]) // lastDeltaWindowEnd
    selectQueue.push([]) // todaysCortexCreatedAt
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ])
    selectQueue.push([{ total: 3 }])
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
    const ask = vi.fn().mockResolvedValue({ text: 'window' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask }, decision: {} } as never)
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-1' }, created: true } as never)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    const call = vi.mocked(captureMemory).mock.calls[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(call.sourceMetadata.since).toBe(until)
    // This fold stores the end of its own window for the next run.
    expect(call.sourceMetadata.until).toBe('2026-07-24T15:22:00.000Z')
  })

  it('skips the model call when the routine already answered this slot on Max', async () => {
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { captureMemory } = await import('@/lib/data/memories')
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')
    const { isJobDone } = await import('@/lib/data/thinking-jobs')
    vi.mocked(isJobDone).mockResolvedValueOnce(true)
    queueDominionLookup()
    selectQueue.push([])
    selectQueue.push([])
    selectQueue.push([
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ])
    selectQueue.push([{ total: 3 }])
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)

    const { runMicroConsolidateForDominion } = await import('../micro-consolidate')
    const result = await runMicroConsolidateForDominion(USER_ID, DOMINION_ID)

    expect(isJobDone).toHaveBeenCalledWith(USER_ID, `micro_consolidate:${DOMINION_ID}:2026-07-24T15`)
    expect(result).toEqual({ dominionId: DOMINION_ID, dominionName: 'AEON', status: 'existing', reason: 'answered on Max' })
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('scopes board counts to this Dominion (not user-wide)', async () => {
    const { countTasksCompletedBetween, countTasksCreatedBetween } = await import('@/lib/data/board-signals')
    await runWithAnchors(null, null)
    expect(countTasksCompletedBetween).toHaveBeenCalledWith(
      USER_ID, expect.any(Date), expect.any(Date), { dominionId: DOMINION_ID },
    )
    expect(countTasksCreatedBetween).toHaveBeenCalledWith(
      USER_ID, expect.any(Date), expect.any(Date), { dominionId: DOMINION_ID },
    )
  })
})

describe('runMicroConsolidateForUser — per-Dominion failure isolation', { timeout: 20000 }, () => {
  const DOM_A = '11111111-1111-4111-8111-111111111111'
  const DOM_B = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
  })

  it('continues to the next Dominion after one throws, traces the failure, and writes liveness for the survivor', async () => {
    const { findDominionsByUser } = await import('@/lib/data/dominions')
    const { captureMemory } = await import('@/lib/data/memories')
    vi.mocked(findDominionsByUser).mockResolvedValue([
      { id: DOM_A, name: 'Dominion A', archivedAt: null } as never,
      { id: DOM_B, name: 'Dominion B', archivedAt: null } as never,
    ])

    // Dominion A: the dominion-lookup select throws synchronously via a
    // custom db mock override for this test only.
    const { db } = await import('@/lib/db')
    let call = 0
    vi.mocked(db.select).mockImplementation(() => {
      call += 1
      if (call === 1) {
        return {
          from: () => ({ where: () => ({ limit: () => Promise.reject(new Error('db exploded')) }) }),
        } as never
      }
      // Dominion B: dominion lookup succeeds, then below-threshold skip.
      const rowsByCall: Record<number, unknown[]> = {
        2: [{ id: DOM_B, name: 'Dominion B', archivedAt: null }],
        3: [], // lastDeltaCreatedAt
        4: [], // todaysCortexCreatedAt
        5: [], // fetchNewMemoriesSince rows — 0, below threshold
        6: [{ total: 0 }], // fetchNewMemoriesSince total
      }
      const rows = rowsByCall[call] ?? []
      const chain: Record<string, unknown> = {}
      const pass = () => chain
      chain.from = pass
      chain.where = pass
      chain.orderBy = pass
      chain.limit = pass
      chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
      return chain as never
    })

    const { runMicroConsolidateForUser } = await import('../micro-consolidate')
    const results = await runMicroConsolidateForUser(USER_ID)

    expect(results).toHaveLength(2)
    expect(results[0].status).toBe('error')
    expect(results[0].dominionId).toBe(DOM_A)
    expect(results[1].status).toBe('skipped')
    expect(results[1].dominionId).toBe(DOM_B)

    const traceCalls = vi.mocked(captureMemory).mock.calls.filter(
      (c) => (c[1] as { streamClass?: string }).streamClass === 'trace',
    )
    const metas = traceCalls.map((c) => (c[1] as { sourceMetadata: Record<string, unknown>; dominionId: string | null }))
    expect(metas).toHaveLength(2)
    const failure = metas.find((m) => m.sourceMetadata.reason)!
    expect(failure.dominionId).toBe(DOM_A)
    expect(failure.sourceMetadata).toMatchObject({ cronName: 'micro-consolidate', reason: 'uncaught_exception' })
    // Dominion B's below-threshold no-op proves the cron ran — a skipped
    // liveness row with a per-day externalId (idempotent across 6 runs/day).
    const liveness = metas.find((m) => !m.sourceMetadata.reason)!
    expect(liveness.dominionId).toBe(DOM_B)
    expect(liveness.sourceMetadata).toMatchObject({
      cronName: 'micro-consolidate',
      outcome: 'skipped',
      skipReason: 'below threshold',
    })
    expect(liveness.sourceMetadata.externalId).toMatch(new RegExp(`^cron-skipped:micro-consolidate:${DOM_B}:\\d{4}-\\d{2}-\\d{2}$`))
  })
})

describe('persistMicroConsolidateDelta — shared by the cron and the routine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('writes the slot-bucket delta with its window and the routine provenance', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'delta-mem-9' }, created: true } as never)
    const { persistMicroConsolidateDelta } = await import('../micro-consolidate')

    const out = await persistMicroConsolidateDelta(USER_ID, {
      dominionId: DOMINION_ID,
      dominionName: 'AEON',
      bucket: '2026-10-01T09',
      since: new Date('2026-10-01T06:15:00.000Z'),
      until: new Date('2026-10-01T08:30:00.000Z'),
      bodyMd: 'Two ideas landed.',
      newMemoryCount: 30,
      newMemoryTotal: 41,
      tasksCompleted: 2,
      tasksCreated: 1,
      provenance: { answeredBy: 'routine', thinkingJobId: 'job-1' },
    })

    expect(out).toEqual({ memoryId: 'delta-mem-9', created: true })
    expect(captureMemory).toHaveBeenCalledWith(USER_ID, {
      title: 'AEON · delta 2026-10-01T09',
      bodyMd: 'Two ideas landed.',
      type: 'observation',
      streamClass: 'delta',
      source: 'cron',
      dominionId: DOMINION_ID,
      sourceMetadata: {
        externalId: `micro-consolidate:${DOMINION_ID}:2026-10-01T09`,
        kind: 'micro_consolidate',
        since: '2026-10-01T06:15:00.000Z',
        until: '2026-10-01T08:30:00.000Z',
        newMemoryCount: 30,
        tasksCompleted: 2,
        tasksCreated: 1,
        truncated: true,
        newMemoryTotal: 41,
        answeredBy: 'routine',
        thinkingJobId: 'job-1',
      },
    })
  })
})

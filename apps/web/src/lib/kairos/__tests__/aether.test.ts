import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Same chainable-query mock pattern as retrieve.test.ts. `selectQueue` feeds
// db.select() calls in the exact order runAetherForUser fires them:
// alreadyRanToday -> active dominions -> cortexRows -> reflectionRows ->
// archetypeRows -> priorRows -> consolidated-day deltas -> consolidated-day
// fallback count. `txArchivedRows`/`txInsertedRows` feed the archive+insert inside
// persistAether's db.transaction.
const selectQueue: unknown[][] = []
let txArchivedRows: Array<{ id: string }> = []
let txInsertedRows: Array<{ id: string }> = []
let txInsertedValues: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
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
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(txArchivedRows) }) }) }),
          insert: () => ({ values: (v: Record<string, unknown>) => {
            txInsertedValues.push(v)
            return { returning: () => Promise.resolve(txInsertedRows) }
          } }),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  // Stand-in for the real bi-temporal gate — content doesn't matter here,
  // db.select is fully mocked below and never inspects the SQL it's given.
  validAsOfNow: 'mock-valid-as-of-now',
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

// Spy (not stub) the range operators so the day-window test can assert bounds.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, gte: vi.fn(actual.gte), lt: vi.fn(actual.lt) }
})

import { gte, lt } from 'drizzle-orm'
import { runAetherForUser } from '../aether'
import { AETHER_SYSTEM_PROMPT } from '../aether-prompt'
import { captureMemory } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'

const USER_ID = 'user-1'
const REFLECTION_ID = '11111111-1111-4111-8111-111111111111'
const MEMORY_ID = '22222222-2222-4222-8222-222222222222'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function queueSignalInputs() {
  selectQueue.push([{ n: 0 }]) // alreadyRanToday: not yet run
  selectQueue.push([]) // active dominions
  selectQueue.push([]) // cortexRows
  selectQueue.push([ // reflectionRows — enough to satisfy hasSignal
    { id: REFLECTION_ID, dominionId: null, title: 'Reflection', summary: 's', createdAt: new Date('2026-07-01') },
  ])
  selectQueue.push([]) // archetypeRows
  selectQueue.push([]) // priorRows
  selectQueue.push([]) // consolidated day: delta memories — none
  selectQueue.push([{ n: 0 }]) // consolidated day: fallback new-memory count — zero
}

function thought(id: string, sourceMemoryIds: string[]) {
  return {
    id,
    title: 'Focus',
    insight: 'A sufficiently long paragraph describing this synthesised thought for schema validation.',
    dominionId: null,
    dominionName: null,
    dominionColor: null,
    salience: 0.7,
    kind: 'conclusion',
    sourceMemoryIds,
    ageDays: 3,
  }
}

function aetherJson(thoughts: unknown[], tensions: unknown[] = []): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    coreNarrative: 'A grounded narrative describing the operator across all their Dominions right now.',
    thoughts,
    tensions,
    shifts: [],
  })
}

function validAetherJson(): string {
  return aetherJson([thought('t1', [REFLECTION_ID])])
}

function traceCalls() {
  return (captureMemory as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => (call[1] as Record<string, unknown>).streamClass === 'trace',
  )
}

function failureTraces() {
  return traceCalls().filter((c) => 'reason' in (c[1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata)
}

function storedAether(): { thoughts: Array<{ id: string; sourceMemoryIds: string[] }>; tensions: Array<{ aId: string; bId: string; note: string }> } {
  const meta = txInsertedValues[0].sourceMetadata as { aether: ReturnType<typeof storedAether> }
  return meta.aether
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  txArchivedRows = []
  txInsertedRows = []
  txInsertedValues = []
})

// Heavier DB-mocked tests than the pure-function suites; give them headroom so
// they don't flake on the default 5s timeout under full-suite load.
describe('runAetherForUser — failure traces (C1) + retry/repair (C2)', { timeout: 20000 }, () => {
  it('writes a failure trace on empty model response', async () => {
    queueSignalInputs()
    const ask = vi.fn().mockResolvedValue({ text: '   ' })
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const result = await runAetherForUser(USER_ID)

    expect(result).toEqual({ generated: false, reason: 'empty_response' })
    expect(ask).toHaveBeenCalledTimes(1)
    const traces = traceCalls()
    expect(traces).toHaveLength(1)
    expect((traces[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata.reason).toBe('empty_response')
  })

  it('does NOT write a failure trace when the credential is missing (benign skip)', async () => {
    queueSignalInputs()
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockRejectedValue(new AiCredentialMissingError('anthropic'))

    const result = await runAetherForUser(USER_ID)

    expect(result).toEqual({ generated: false, reason: 'no_credential' })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('repairs malformed JSON on the second attempt and generates successfully', async () => {
    queueSignalInputs()
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: 'not json at all' })
      .mockResolvedValueOnce({ text: validAetherJson() })
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    txInsertedRows = [{ id: 'aether-mem-1' }]

    const result = await runAetherForUser(USER_ID)

    expect(result).toEqual({ generated: true, reason: 'ok' })
    expect(ask).toHaveBeenCalledTimes(2)
    // Repair (shared parseWithRepair) carries the raw output, the aether system
    // block, and the valid memory-id list.
    const repairReq = ask.mock.calls[1][0]
    expect(repairReq.prompt).toContain('not json at all')
    expect(repairReq.prompt).toContain('## Reference context')
    expect(repairReq.prompt).toContain(REFLECTION_ID)
    expect(repairReq.system).toBe(AETHER_SYSTEM_PROMPT)
    expect(repairReq.cacheSystem).toBe(true)
    expect(failureTraces()).toHaveLength(0)
  })

  it('writes a failure trace with the validation error when the repair also fails', async () => {
    queueSignalInputs()
    const ask = vi.fn().mockResolvedValue({ text: 'not json at all', finishReason: 'length' })
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const result = await runAetherForUser(USER_ID)

    expect(result.generated).toBe(false)
    expect(result.reason).toMatch(/^parse_failed:/)
    expect(ask).toHaveBeenCalledTimes(2)
    const traces = traceCalls()
    expect(traces).toHaveLength(1)
    const sm = traces[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(sm.sourceMetadata.reason).toBe('parse_failed')
    expect(typeof sm.sourceMetadata.error).toBe('string')
    expect(sm.sourceMetadata.finishReason).toBe('length')
    expect(sm.sourceMetadata.rawExcerpt).toBe('not json at all')
  })

  it('preserves the original validation error when the repair call itself throws', async () => {
    // The repair round-trip hits a transient transport error. The trace and
    // reason must carry the ORIGINAL parse failure (the real diagnostic), not
    // the network error — otherwise C1's observability is defeated.
    queueSignalInputs()
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: 'not json at all' })
      .mockRejectedValueOnce(new Error('repair-transport-boom'))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const result = await runAetherForUser(USER_ID)

    expect(result.generated).toBe(false)
    expect(result.reason).toMatch(/^parse_failed:/)
    // Repair failure surfaces as secondary context, not the primary reason.
    expect(result.reason).toContain('repair also failed: repair-transport-boom')
    expect(ask).toHaveBeenCalledTimes(2) // main + one bare repair (not retried)
    const traces = traceCalls()
    expect(traces).toHaveLength(1)
    const sm = traces[0][1] as { sourceMetadata: Record<string, unknown> }
    expect(sm.sourceMetadata.reason).toBe('parse_failed')
    // The traced error is the original schema failure, NOT the transport error.
    expect(sm.sourceMetadata.error).not.toContain('repair-transport-boom')
  })

  it('writes a failure trace when persist returns no id', async () => {
    queueSignalInputs()
    const ask = vi.fn().mockResolvedValue({ text: validAetherJson() })
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    txInsertedRows = [] // insert returns nothing -> aetherMemoryId stays null

    const result = await runAetherForUser(USER_ID)

    expect(result).toEqual({ generated: false, reason: 'persist_failed' })
    const traces = traceCalls()
    expect(traces).toHaveLength(1)
    expect((traces[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata.reason).toBe('persist_failed')
  })
})

describe('runAetherForUser — server-minted ids + grounding (A2) + liveness', { timeout: 20000 }, () => {
  function runWith(text: string) {
    queueSignalInputs()
    const ask = vi.fn().mockResolvedValue({ text })
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    txInsertedRows = [{ id: 'aether-mem-1' }]
    return { ask, result: runAetherForUser(USER_ID) }
  }

  it('accepts model-invented non-RFC "UUIDs" and short labels, storing minted v4 UUIDs', async () => {
    // Version nibble 1 / variant 0 — the exact shape that broke the 2026-09-28 run.
    const bogus = '12345678-1234-1234-0234-123456789abc'
    const { ask, result } = runWith(aetherJson(
      [thought(bogus, [REFLECTION_ID]), thought('t2', [REFLECTION_ID])],
      [{ aId: bogus, bId: 't2', note: 'pull between the two' }],
    ))

    expect(await result).toEqual({ generated: true, reason: 'ok' })
    expect(ask).toHaveBeenCalledTimes(1) // no repair round-trip needed
    const stored = storedAether()
    expect(stored.thoughts).toHaveLength(2)
    for (const t of stored.thoughts) expect(t.id).toMatch(UUID_RE)
    expect(stored.thoughts[0].id).not.toBe(stored.thoughts[1].id)
    expect(stored.tensions).toEqual([
      { aId: stored.thoughts[0].id, bId: stored.thoughts[1].id, note: 'pull between the two' },
    ])
  })

  it('drops dangling and self-referencing tensions', async () => {
    const { result } = runWith(aetherJson(
      [thought('t1', [REFLECTION_ID]), thought('t2', [REFLECTION_ID])],
      [
        { aId: 't1', bId: 't9', note: 'dangling end' },
        { aId: 't2', bId: 't2', note: 'self tension' },
        { aId: 't2', bId: 't1', note: 'kept' },
      ],
    ))

    expect(await result).toEqual({ generated: true, reason: 'ok' })
    const stored = storedAether()
    expect(stored.tensions).toEqual([{ aId: stored.thoughts[1].id, bId: stored.thoughts[0].id, note: 'kept' }])
  })

  it('drops sourceMemoryIds not fed into the prompt; a thought left with none is dropped', async () => {
    const { result } = runWith(aetherJson(
      [thought('t1', [REFLECTION_ID, MEMORY_ID]), thought('t2', [MEMORY_ID]), thought('t3', ['r1'])],
      [{ aId: 't1', bId: 't2', note: 'points at a dropped thought' }],
    ))

    expect(await result).toEqual({ generated: true, reason: 'ok' })
    const stored = storedAether()
    expect(stored.thoughts).toHaveLength(1)
    expect(stored.thoughts[0].sourceMemoryIds).toEqual([REFLECTION_ID])
    expect(stored.tensions).toEqual([])
  })

  it('reports all_thoughts_ungrounded when no citation is in the fed set', async () => {
    const { result } = runWith(aetherJson([thought('t1', [MEMORY_ID])]))

    expect(await result).toEqual({ generated: false, reason: 'all_thoughts_ungrounded' })
    expect(txInsertedValues).toHaveLength(0)
  })

  it('writes an ok liveness trace (no reason field) on successful persist', async () => {
    const { result } = runWith(validAetherJson())

    expect(await result).toEqual({ generated: true, reason: 'ok' })
    const traces = traceCalls()
    expect(traces).toHaveLength(1)
    const sm = (traces[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm).toMatchObject({ cronName: 'aether-regen', outcome: 'ok' })
    expect('reason' in sm).toBe(false)
  })

  it('writes a skipped liveness trace when aether already ran today', async () => {
    selectQueue.push([{ n: 1 }])

    const result = await runAetherForUser(USER_ID)

    expect(result).toEqual({ generated: false, reason: 'already_ran' })
    const sm = (traceCalls()[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm).toMatchObject({ cronName: 'aether-regen', outcome: 'skipped', skipReason: 'already_ran' })
    expect(getProviderForTask).not.toHaveBeenCalled()
  })
})

describe('fetchAetherInputs — day-being-consolidated grounding (previous UTC day)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T03:15:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function queueEmptyInputs() {
    selectQueue.push([]) // active dominions
    selectQueue.push([]) // cortexRows
    selectQueue.push([]) // reflectionRows
    selectQueue.push([]) // archetypeRows
    selectQueue.push([]) // priorRows
  }

  it('bounds the delta window to the previous UTC day, not the new (empty) one', async () => {
    queueEmptyInputs()
    selectQueue.push([{ bodyMd: 'delta' }])

    const { fetchAetherInputs } = await import('../aether')
    await fetchAetherInputs(USER_ID)

    const gteDates = vi.mocked(gte).mock.calls.map((c) => c[1]).filter((v) => v instanceof Date)
    const ltDates = vi.mocked(lt).mock.calls.map((c) => c[1]).filter((v) => v instanceof Date)
    expect(gteDates).toEqual([new Date('2026-09-28T00:00:00.000Z')])
    expect(ltDates).toEqual([new Date('2026-09-29T00:00:00.000Z')])
  })

  it('joins the previous day\'s deltas chronologically (query returns newest first)', async () => {
    queueEmptyInputs()
    selectQueue.push([{ bodyMd: 'Evening fold.' }, { bodyMd: 'Morning fold.' }])

    const { fetchAetherInputs } = await import('../aether')
    const inputs = await fetchAetherInputs(USER_ID)

    expect(inputs.todaySoFar).toBe('Morning fold.\n\n---\n\nEvening fold.')
  })

  it('falls back to a singular count line labelled with the consolidated day', async () => {
    queueEmptyInputs()
    selectQueue.push([]) // deltas — none
    selectQueue.push([{ n: 1 }])

    const { fetchAetherInputs } = await import('../aether')
    const inputs = await fetchAetherInputs(USER_ID)

    expect(inputs.todaySoFar).toBe('1 new memory captured on 2026-09-28 across all Dominions.')
  })

  it('falls back to a plural count line, or null when the day was empty', async () => {
    queueEmptyInputs()
    selectQueue.push([])
    selectQueue.push([{ n: 5 }])
    const { fetchAetherInputs } = await import('../aether')
    expect((await fetchAetherInputs(USER_ID)).todaySoFar).toBe('5 new memories captured on 2026-09-28 across all Dominions.')

    queueEmptyInputs()
    selectQueue.push([])
    selectQueue.push([{ n: 0 }])
    expect((await fetchAetherInputs(USER_ID)).todaySoFar).toBeNull()
  })
})
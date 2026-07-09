import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same chainable-query mock pattern as retrieve.test.ts. `selectQueue` feeds
// db.select() calls in the exact order runAetherForUser fires them:
// alreadyRanToday -> active dominions -> cortexRows -> reflectionRows ->
// archetypeRows -> priorRows. `txArchivedRows`/`txInsertedRows` feed the
// archive+insert inside persistAether's db.transaction.
const selectQueue: unknown[][] = []
let txArchivedRows: Array<{ id: string }> = []
let txInsertedRows: Array<{ id: string }> = []

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
          insert: () => ({ values: () => ({ returning: () => Promise.resolve(txInsertedRows) }) }),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

import { runAetherForUser } from '../aether'
import { captureMemory } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'

const USER_ID = 'user-1'
const REFLECTION_ID = '11111111-1111-4111-8111-111111111111'
const MEMORY_ID = '22222222-2222-4222-8222-222222222222'

function queueSignalInputs() {
  selectQueue.push([{ n: 0 }]) // alreadyRanToday: not yet run
  selectQueue.push([]) // active dominions
  selectQueue.push([]) // cortexRows
  selectQueue.push([ // reflectionRows — enough to satisfy hasSignal
    { id: REFLECTION_ID, dominionId: null, title: 'Reflection', summary: 's', createdAt: new Date('2026-07-01') },
  ])
  selectQueue.push([]) // archetypeRows
  selectQueue.push([]) // priorRows
}

function validAetherJson(): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    coreNarrative: 'A grounded narrative describing the operator across all their Dominions right now.',
    thoughts: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Focus',
        insight: 'A sufficiently long paragraph describing this synthesised thought for schema validation.',
        dominionId: null,
        dominionName: null,
        dominionColor: null,
        salience: 0.7,
        kind: 'conclusion',
        sourceMemoryIds: [MEMORY_ID],
        ageDays: 3,
      },
    ],
    tensions: [],
    shifts: [],
  })
}

function traceCalls() {
  return (captureMemory as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => (call[1] as Record<string, unknown>).streamClass === 'trace',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  txArchivedRows = []
  txInsertedRows = []
})

describe('runAetherForUser — failure traces (C1) + retry/repair (C2)', () => {
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
    // Repair prompt carries the raw failed output forward for the model to fix.
    const repairPrompt = ask.mock.calls[1][0].prompt as string
    expect(repairPrompt).toContain('not json at all')
    expect(traceCalls()).toHaveLength(0)
  })

  it('writes a failure trace with the validation error when the repair also fails', async () => {
    queueSignalInputs()
    const ask = vi.fn().mockResolvedValue({ text: 'not json at all' })
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySurpriseLedger } from '../ledger'
import type { KairosSurpriseLedger } from '@/lib/data/validators/kairos-surprise'

const GOAL = '11111111-1111-4111-8111-111111111111'
const SEED = '22222222-2222-4222-8222-222222222222'
const BELIEF = '33333333-3333-4333-8333-333333333333'

const m = vi.hoisted(() => ({
  readKairosAgenda: vi.fn(),
  readKairosPredictions: vi.fn(),
  readKairosPromises: vi.fn(),
  listOpenGoals: vi.fn(),
  listReplayCiters: vi.fn(),
  listReplayRows: vi.fn(),
  listRecentReplaySets: vi.fn(),
  mutateKairosSurprise: vi.fn(),
}))
const { readKairosAgenda, readKairosPredictions, readKairosPromises, listOpenGoals, listReplayCiters, listReplayRows, listRecentReplaySets, mutateKairosSurprise } = m
let ledger: KairosSurpriseLedger = emptySurpriseLedger()

vi.mock('@/lib/data/kairos-agenda', () => ({ readKairosAgenda: m.readKairosAgenda }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: m.readKairosPredictions }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: m.readKairosPromises }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: m.listOpenGoals }))
vi.mock('@/lib/data/replay-candidates', () => ({
  listReplayCiters: m.listReplayCiters,
  listReplayRows: m.listReplayRows,
  listRecentReplaySets: m.listRecentReplaySets,
}))
vi.mock('@/lib/data/kairos-surprise', () => ({ mutateKairosSurprise: m.mutateKairosSurprise }))

import { cortexDueSoonContext, loadAetherReplay, replayIdsOf, replayMetadata } from '../replay-reader'

const NOW = new Date('2026-10-03T03:00:00.000Z')

beforeEach(() => {
  ledger = { ...emptySurpriseLedger(), replay: { night: '2026-10-02', ids: [SEED, 'gone'] } }
  mutateKairosSurprise.mockImplementation(async (_u: string, fn: (l: KairosSurpriseLedger) => { state: KairosSurpriseLedger | null; result: unknown }) => {
    const { state, result } = fn(ledger)
    if (state) ledger = state
    return result
  })
  readKairosAgenda.mockResolvedValue({ open: [] })
  readKairosPredictions.mockResolvedValue({ open: [] })
  readKairosPromises.mockResolvedValue({ open: [] })
  listOpenGoals.mockResolvedValue([{ id: GOAL, dominionId: 'dom-1', meta: { seeds: [{ kind: 'idea', id: SEED }] } }])
  listReplayCiters.mockResolvedValue([{ id: BELIEF, dominionId: 'dom-1', provenance: [GOAL] }])
  listReplayRows.mockResolvedValue([
    { id: GOAL, title: 'Ship the beta', summary: null, dominionId: 'dom-1', sourceMetadata: {} },
    { id: SEED, title: 'Seed idea', summary: 'why', dominionId: 'dom-2', sourceMetadata: {} },
    { id: BELIEF, title: 'Beta needs auth', summary: null, dominionId: 'dom-1', sourceMetadata: { engine: { surprise: { openUntil: '2026-10-04T07:00:00.000Z', signals: [] } } } },
  ])
  listRecentReplaySets.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('replay reader', () => {
  it('off: reads nothing, returns nothing', async () => {
    expect(await loadAetherReplay('u', NOW, null)).toBeNull()
    expect(await cortexDueSoonContext('u', 'dom-1', NOW)).toEqual({})
    for (const fn of [readKairosAgenda, listOpenGoals, listReplayRows, mutateKairosSurprise]) expect(fn).not.toHaveBeenCalled()
  })

  it('observe: scores and stores tonight (ledger), cortex stays render-free', async () => {
    vi.stubEnv('KAIROS_SURPRISE_REPLAY', 'observe')
    const prior = { payload: { thoughts: [{ sourceMemoryIds: [SEED] }] } } as never
    const plan = await loadAetherReplay('u', NOW, prior)
    expect(plan).toMatchObject({ mode: 'observe', night: '2026-10-03' })
    // open belief (need .56 × gain 1) beats the goal (.7 × .4) and the seed (.7 × .4)
    expect(plan!.ids[0]).toBe(BELIEF)
    expect(plan!.items[0].note).toBe('belief behind something due soon; under question')
    expect(ledger.replay).toEqual({ night: '2026-10-03', ids: plan!.ids, prevHits: 1 })
    expect(await cortexDueSoonContext('u', 'dom-1', NOW)).toEqual({})
  })

  it('on: cortex gets its own Dominion only, without ids', async () => {
    vi.stubEnv('KAIROS_SURPRISE_REPLAY', '1')
    const { dueSoon } = await cortexDueSoonContext('u', 'dom-1', NOW)
    expect(dueSoon!.map((d) => d.title)).toEqual(['Beta needs auth', 'Ship the beta'])
    expect(JSON.stringify(dueSoon)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('a failed source read only silences that source; a failed row read means no replay', async () => {
    vi.stubEnv('KAIROS_SURPRISE_REPLAY', '1')
    readKairosAgenda.mockRejectedValue(new Error('corrupt'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await loadAetherReplay('u', NOW, null))!.ids).toHaveLength(3)
    listReplayRows.mockRejectedValue(new Error('db down'))
    expect(await loadAetherReplay('u', NOW, null)).toBeNull()
  })

  it('carries replay ids from plan to apply and onto the aether row', () => {
    expect(replayMetadata(null)).toEqual({})
    expect(replayMetadata({ ids: ['a'] })).toEqual({ surpriseReplay: { ids: ['a'] } })
    expect(replayIdsOf({ date: 'x' })).toBeNull()
    expect(replayIdsOf({ replayIds: ['a', 3] })).toEqual({ ids: ['a'] })
  })
})

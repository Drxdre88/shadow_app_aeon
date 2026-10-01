import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({
  listUnmirroredPromotions: vi.fn(),
  writeOwnMirror: vi.fn(),
  listMirrorsOfRevertedPromotions: vi.fn(),
  retireOwnBelief: vi.fn(),
}))
vi.mock('@/lib/data/beliefs', () => data)

import { beliefV1Schema, OWN_UNKNOWN_FALSIFIER } from '../types'
import { mirrorPromotionsToOwnMind, ownBeliefFromPromotion } from '../mirror'
import type { PromotionToMirror } from '@/lib/data/beliefs'

const USER = 'user-1'
const SINCE = new Date('2026-09-30T00:00:00Z')

function promo(over: Partial<PromotionToMirror> = {}): PromotionToMirror {
  return {
    opId: 'op-1',
    promotedAt: new Date('2026-10-01T02:00:00Z'),
    proposalId: 'prop-1',
    title: 'Retries hide flaky upstreams',
    aiTitle: null,
    summary: null,
    bodyMd: 'Three incidents traced to silent retries. The operator fixed two of them. Sources: [x]',
    dominionId: 'dom-1',
    dominionName: 'Aeon',
    confidence: 0.6,
    sourceMetadata: { citations: ['m-1', 'm-2', 7], introspection: true },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.listMirrorsOfRevertedPromotions.mockResolvedValue([])
})

describe('ownBeliefFromPromotion', () => {
  it('builds a valid v1 own-mind inference belief from the promoted proposal', () => {
    const b = ownBeliefFromPromotion(promo())
    expect(beliefV1Schema.safeParse(b).success).toBe(true)
    expect(b).toMatchObject({
      mind: 'own',
      sourceType: 'inference',
      claim: 'Retries hide flaky upstreams',
      domain: 'Aeon',
      dominionId: 'dom-1',
      falsifier: OWN_UNKNOWN_FALSIFIER,
      status: 'held',
      confidence: 0.6,
      provenance: ['prop-1', 'm-1', 'm-2'],
    })
    expect(b.reasons).toEqual(['Three incidents traced to silent retries.', 'The operator fixed two of them.'])
  })

  it('falls back to general domain and the idea prior when the proposal lacks them', () => {
    const b = ownBeliefFromPromotion(promo({ dominionId: null, dominionName: null, confidence: null, bodyMd: '' }))
    expect(b).toMatchObject({ domain: 'general', dominionId: null, confidence: 0.6, reasons: [] })
  })
})

describe('mirrorPromotionsToOwnMind', () => {
  it('mirrors each unmirrored promotion once, keyed by its proposal', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([promo()])
    data.writeOwnMirror.mockResolvedValue({ memoryId: 'b-1', written: true })

    const res = await mirrorPromotionsToOwnMind(USER, SINCE, { runId: 'run-7' })

    expect(res).toMatchObject({ mirrored: ['b-1'], retired: [], errors: [], examined: 1, planned: [], stopped: false })
    expect(data.listUnmirroredPromotions).toHaveBeenCalledWith(USER, SINCE)
    const [, values, meta] = data.writeOwnMirror.mock.calls[0]
    expect(meta).toMatchObject({ proposalId: 'prop-1', sourceOpId: 'op-1', runId: 'run-7' })
    expect(values.sourceMetadata.belief.mind).toBe('own')
  })

  it('is idempotent: a re-run reports nothing new when the mirror already exists', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([promo()])
    data.writeOwnMirror.mockResolvedValue({ memoryId: 'b-1', written: false })
    expect((await mirrorPromotionsToOwnMind(USER, SINCE)).mirrored).toEqual([])

    data.listUnmirroredPromotions.mockResolvedValue([])
    expect(await mirrorPromotionsToOwnMind(USER, SINCE)).toMatchObject({ mirrored: [], retired: [], errors: [], examined: 0 })
  })

  it('retires mirrors whose source promotion was reverted (operator veto)', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([])
    data.listMirrorsOfRevertedPromotions.mockResolvedValue([{ beliefId: 'b-9', opId: 'op-9' }])
    data.retireOwnBelief.mockResolvedValue(true)
    expect((await mirrorPromotionsToOwnMind(USER, SINCE)).retired).toEqual(['b-9'])
  })

  it('isolates a failing promotion and keeps going', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([promo({ proposalId: 'p-bad' }), promo({ proposalId: 'p-ok', opId: 'op-2' })])
    data.writeOwnMirror.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ memoryId: 'b-2', written: true })
    const res = await mirrorPromotionsToOwnMind(USER, SINCE)
    expect(res.mirrored).toEqual(['b-2'])
    expect(res.errors).toEqual(['p-bad: boom'])
  })

  it('tags a retirement op with the run id', async () => {
    const now = new Date('2026-10-01T01:40:00Z')
    data.listUnmirroredPromotions.mockResolvedValue([])
    data.listMirrorsOfRevertedPromotions.mockResolvedValue([{ beliefId: 'b-9', opId: 'op-9' }])
    data.retireOwnBelief.mockResolvedValue(true)
    await mirrorPromotionsToOwnMind(USER, SINCE, { runId: 'run-7', now })
    expect(data.retireOwnBelief).toHaveBeenCalledWith(USER, 'b-9', expect.stringContaining('op-9'), now, 'run-7')
  })

  it('dry run plans the ops and writes nothing', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([promo()])
    data.listMirrorsOfRevertedPromotions.mockResolvedValue([{ beliefId: 'b-9', opId: 'op-9' }])
    const res = await mirrorPromotionsToOwnMind(USER, SINCE, { dryRun: true })
    expect(data.writeOwnMirror).not.toHaveBeenCalled()
    expect(data.retireOwnBelief).not.toHaveBeenCalled()
    expect(res.planned).toEqual([
      expect.objectContaining({ memoryId: null, step: 'beliefs', op: 'promote', after: expect.objectContaining({ mirroredFrom: 'prop-1' }) }),
      expect.objectContaining({ memoryId: 'b-9', step: 'beliefs', op: 'decay' }),
    ])
    expect(res).toMatchObject({ mirrored: [], retired: [], examined: 2 })
  })

  it('stops before the next write once told to', async () => {
    data.listUnmirroredPromotions.mockResolvedValue([promo({ proposalId: 'p-1' }), promo({ proposalId: 'p-2' })])
    data.listMirrorsOfRevertedPromotions.mockResolvedValue([{ beliefId: 'b-9', opId: 'op-9' }])
    data.writeOwnMirror.mockResolvedValue({ memoryId: 'b-1', written: true })
    let calls = 0
    const res = await mirrorPromotionsToOwnMind(USER, SINCE, { stop: () => calls++ >= 1 })
    expect(data.writeOwnMirror).toHaveBeenCalledTimes(1)
    expect(data.retireOwnBelief).not.toHaveBeenCalled()
    expect(res).toMatchObject({ mirrored: ['b-1'], stopped: true, examined: 3 })
  })
})

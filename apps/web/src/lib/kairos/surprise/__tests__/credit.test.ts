import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-surprise', () => ({ mutateKairosSurprise: vi.fn(), readKairosSurprise: vi.fn() }))
vi.mock('@/lib/data/belief-citers', () => ({ listBeliefCiters: vi.fn(), listHeldBeliefIdsAmong: vi.fn() }))
vi.mock('@/lib/data/surprise-marks', () => ({ openForUpdate: vi.fn(async (_u: string, ids: string[]) => ids) }))
vi.mock('@/lib/kairos/reactions', () => ({ reactOutcome: vi.fn() }))

import type { BeliefCiter } from '@/lib/data/belief-citers'
import { listBeliefCiters, listHeldBeliefIdsAmong } from '@/lib/data/belief-citers'
import { mutateKairosSurprise, readKairosSurprise } from '@/lib/data/kairos-surprise'
import { openForUpdate } from '@/lib/data/surprise-marks'
import { kairosSurpriseLedgerSchema, type KairosSurpriseLedger } from '@/lib/data/validators/kairos-surprise'
import { reactOutcome } from '@/lib/kairos/reactions'
import { creditBackward, creditPolicy, planBackwardCredit, type CreditBackwardInput } from '../credit'
import { emptySurpriseLedger, pruneSurpriseLedger } from '../ledger'

const NOW = new Date('2026-10-03T09:00:00.000Z')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const REFLECTION = id(900)
const BASIS_BELIEF = id(901)
const citer = (n: number, provenance: string[], dominionId: string | null = null): BeliefCiter => ({ id: id(n), dominionId, provenance })

const wrong = (over: Partial<CreditBackwardInput> = {}): CreditBackwardInput => ({
  kind: 'prediction', id: id(1), outcome: 'wrong', s: 0.8, basisIds: [REFLECTION, BASIS_BELIEF],
  dominionId: null, label: 'prediction R1 wrong', probability: 0.8, excludeIds: [REFLECTION, BASIS_BELIEF], ...over,
})

let box: { ledger: KairosSurpriseLedger }

beforeEach(() => {
  vi.clearAllMocks()
  box = { ledger: emptySurpriseLedger() }
  vi.mocked(readKairosSurprise).mockImplementation(async () => box.ledger)
  vi.mocked(mutateKairosSurprise).mockImplementation(async (_u, mutate, now) => {
    const { state, result } = mutate(box.ledger)
    if (state) box.ledger = kairosSurpriseLedgerSchema.parse(pruneSurpriseLedger(state, now ?? NOW))
    return result
  })
  vi.mocked(listHeldBeliefIdsAmong).mockResolvedValue([BASIS_BELIEF])
  vi.mocked(listBeliefCiters).mockResolvedValue([
    citer(10, [REFLECTION, id(50)]),
    citer(11, [REFLECTION, BASIS_BELIEF]),
  ])
})
afterEach(() => { delete process.env.KAIROS_SURPRISE_CREDIT })

describe('creditPolicy', () => {
  it.each([
    [{ kind: 'prediction', outcome: 'wrong', probability: 0.65 }, { event: 'prediction_wrong', direction: null, open: true }],
    [{ kind: 'prediction', outcome: 'wrong', probability: 0.55 }, { event: null, direction: null, open: false }],
    [{ kind: 'prediction', outcome: 'right', probability: 0.75 }, { event: 'prediction_right', direction: 'positive', open: false }],
    [{ kind: 'promise', outcome: 'kept' }, { event: 'promise_kept', direction: 'positive', open: false }],
    [{ kind: 'promise', outcome: 'lapsed' }, { event: 'promise_lapsed', direction: 'negative', open: true }],
    [{ kind: 'promise', outcome: 'dropped' }, { event: 'promise_dropped', direction: null, open: false }],
  ] as const)('%o → %o', (input, expected) => {
    expect(creditPolicy(input)).toEqual(expected)
  })
})

describe('planBackwardCredit', () => {
  const policy = { event: 'prediction_wrong', direction: 'negative', open: true } as const
  const beliefs = new Set([BASIS_BELIEF])

  it('cuts citers whose share of the anchor is below .25', () => {
    const plan = planBackwardCredit(wrong(), policy, beliefs, [
      citer(10, [REFLECTION, id(50), id(51), id(52)]),
      citer(11, [REFLECTION, id(50), id(51), id(52), id(53)]),
    ])
    expect(plan.credit).toEqual([id(10)])
  })

  it('never re-credits a hop-1 id or a basis id, and credits each belief once', () => {
    const plan = planBackwardCredit(wrong({ basisIds: [REFLECTION, id(20), BASIS_BELIEF], excludeIds: [id(10)] }), policy, beliefs, [
      citer(10, [REFLECTION]),
      citer(11, [REFLECTION, id(20)]),
      citer(20, [REFLECTION]),
    ])
    expect(plan.credit).toEqual([id(11)])
    expect(plan.blamed).toEqual([BASIS_BELIEF, id(11)])
    expect(plan.anchors).toEqual([REFLECTION, id(20)])
  })

  it('caps 3 per anchor and 10 per settlement; same Dominion only', () => {
    const anchors = [0, 1, 2, 3].map((k) => id(700 + k))
    const many = anchors.flatMap((a, k) => [0, 1, 2, 3].map((j) => citer(100 + k * 10 + j, [a], 'd1')))
    const plan = planBackwardCredit(wrong({ basisIds: anchors, dominionId: 'd1', excludeIds: [] }), policy, new Set(), many)
    expect(plan.credit).toHaveLength(10)
    expect(plan.credit.slice(0, 4)).toEqual([id(100), id(101), id(102), id(110)])
    const other = planBackwardCredit(wrong({ basisIds: [anchors[0]!], dominionId: 'd2', excludeIds: [] }), policy, new Set(), many)
    expect(other.credit).toEqual([])
  })
})

describe('creditBackward', () => {
  it('off: no read, no write', async () => {
    expect(await creditBackward('u1', wrong(), { now: NOW })).toBeNull()
    expect(readKairosSurprise).not.toHaveBeenCalled()
    expect(mutateKairosSurprise).not.toHaveBeenCalled()
  })

  it('observe: records the event with would-credit counts; no reaction, nothing opened', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = 'observe'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await creditBackward('u1', wrong(), { now: NOW })
    info.mockRestore()
    expect(res).toMatchObject({ mode: 'observe', created: true, opened: [] })
    expect(reactOutcome).not.toHaveBeenCalled()
    expect(openForUpdate).not.toHaveBeenCalled()
    expect(box.ledger.events[0]).toMatchObject({ kind: 'prediction_wrong', s: 0.8, opened: [], credited: { pos: 0, neg: 2 } })
  })

  it('on: credits hop 2, opens blamed beliefs, and is idempotent per settlement', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    const res = await creditBackward('u1', wrong(), { now: NOW })
    expect(res).toMatchObject({ mode: 'on', created: true, credited: [id(10), id(11)] })
    expect(reactOutcome).toHaveBeenCalledTimes(2)
    expect(reactOutcome).toHaveBeenCalledWith('u1', id(10), 'negative', 'prediction R1 wrong (cited basis)')
    expect(vi.mocked(openForUpdate).mock.calls[0]![1]).toEqual([BASIS_BELIEF, id(10), id(11)])
    expect(box.ledger.events[0]).toMatchObject({ refs: { predictionId: id(1), memoryIds: [REFLECTION] }, credited: { pos: 0, neg: 2 } })

    vi.clearAllMocks()
    const again = await creditBackward('u1', wrong(), { now: NOW })
    expect(again).toMatchObject({ created: false })
    expect(reactOutcome).not.toHaveBeenCalled()
    expect(openForUpdate).not.toHaveBeenCalled()
    expect(box.ledger.events).toHaveLength(1)
  })

  it('on, wrong at p .65: opens and records but credits nothing', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    const res = await creditBackward('u1', wrong({ probability: 0.65, s: 0.65, excludeIds: [] }), { now: NOW })
    expect(res?.credited).toEqual([])
    expect(reactOutcome).not.toHaveBeenCalled()
    expect(openForUpdate).toHaveBeenCalledTimes(1)
  })

  it('promise dropped: event only, no citer read', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    await creditBackward('u1', { kind: 'promise', id: id(2), outcome: 'dropped', s: 0.4, basisIds: [REFLECTION], dominionId: null, label: 'promise P1 dropped' }, { now: NOW })
    expect(listBeliefCiters).not.toHaveBeenCalled()
    expect(box.ledger.events[0]).toMatchObject({ kind: 'promise_dropped', refs: { promiseId: id(2) } })
  })

  it('a failing ledger never throws', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    vi.mocked(readKairosSurprise).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await creditBackward('u1', wrong(), { now: NOW })).toBeNull()
    err.mockRestore()
  })
})

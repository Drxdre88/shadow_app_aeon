import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-surprise', () => ({ mutateKairosSurprise: vi.fn(), readKairosSurprise: vi.fn() }))

import { mutateKairosSurprise, readKairosSurprise } from '@/lib/data/kairos-surprise'
import {
  SURPRISE_MAX_BYTES,
  SURPRISE_MAX_EVENTS,
  SURPRISE_MAX_SEEN,
  kairosSurpriseLedgerSchema,
  type KairosSurpriseLedger,
} from '@/lib/data/validators/kairos-surprise'
import { applySurpriseEvent, emptySurpriseLedger, pruneSurpriseLedger, recordSurprise, surpriseEventId } from '../ledger'
import { loadSurpriseLedger } from '../index'

const NOW = new Date('2026-10-03T09:30:00.000Z')
const DAY = 86_400_000
const ev = (key: string, at = NOW.toISOString()) => ({ key, kind: 'aha' as const, s: 0.3, at })

// Run the real pure mutation against a stored ledger, keeping the result.
function storeWith(initial: KairosSurpriseLedger) {
  const box = { ledger: initial }
  vi.mocked(mutateKairosSurprise).mockImplementation(async (_u, mutate, now) => {
    const { state, result } = mutate(box.ledger)
    if (state) box.ledger = kairosSurpriseLedgerSchema.parse(pruneSurpriseLedger(state, now ?? NOW))
    return result
  })
  return box
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('applySurpriseEvent', () => {
  it('derives a stable s_<hash8> id and fills defaults', () => {
    const { state, result } = applySurpriseEvent(emptySurpriseLedger(), { key: 'k1', kind: 'support_lost', s: 1.7 }, NOW)
    expect(result.created).toBe(true)
    expect(result.event).toEqual({
      id: surpriseEventId('k1'), key: 'k1', at: NOW.toISOString(), kind: 'support_lost', s: 1,
      dominionId: null, refs: { beliefIds: [], memoryIds: [] }, opened: [],
    })
    expect(result.event!.id).toMatch(/^s_[0-9a-f]{8}$/)
    expect(state!.seen).toEqual(['k1'])
  })

  it('is idempotent by key: a repeat writes nothing and returns the stored event', () => {
    const first = applySurpriseEvent(emptySurpriseLedger(), ev('k1'), NOW)
    const again = applySurpriseEvent(first.state!, { ...ev('k1'), s: 0.9 }, NOW)
    expect(again.state).toBeNull()
    expect(again.result).toEqual({ event: first.result.event, created: false })
  })

  it('a key that is seen but aged out of events stays a no-op (null event)', () => {
    const l: KairosSurpriseLedger = { ...emptySurpriseLedger(), seen: ['gone'] }
    expect(applySurpriseEvent(l, ev('gone'), NOW)).toEqual({ state: null, result: { event: null, created: false } })
  })

  it('dedupes and caps refs', () => {
    const { result } = applySurpriseEvent(emptySurpriseLedger(), {
      key: 'k', kind: 'contradiction', s: 0.5, refs: { beliefIds: ['b', 'b', ...Array.from({ length: 40 }, (_, i) => `x${i}`)] },
    }, NOW)
    expect(result.event!.refs.beliefIds[0]).toBe('b')
    expect(result.event!.refs.beliefIds).toHaveLength(24)
  })
})

describe('pruneSurpriseLedger', () => {
  it('drops events older than 7 days (the 7-day edge is kept)', () => {
    const stale = applySurpriseEvent(emptySurpriseLedger(), ev('old'), NOW).state!
    let l: KairosSurpriseLedger = { ...stale, events: [{ ...stale.events[0], at: new Date(NOW.getTime() - 7 * DAY - 1).toISOString() }] }
    l = applySurpriseEvent(l, ev('edge', new Date(NOW.getTime() - 7 * DAY).toISOString()), NOW).state!
    expect(l.events.map((e) => e.key)).toEqual(['edge'])
    expect(l.seen).toEqual(['old', 'edge'])
  })

  it('keeps the newest 64 events and 128 seen keys', () => {
    let l = emptySurpriseLedger()
    for (let i = 0; i < 140; i++) l = applySurpriseEvent(l, ev(`k${i}`), NOW).state!
    expect(l.events).toHaveLength(SURPRISE_MAX_EVENTS)
    expect(l.events.at(-1)!.key).toBe('k139')
    expect(l.events[0].key).toBe('k76')
    expect(l.seen).toHaveLength(SURPRISE_MAX_SEEN)
    expect(l.seen[0]).toBe('k12')
    expect(kairosSurpriseLedgerSchema.safeParse(l).success).toBe(true)
  })

  it('drops oldest events until the blob fits 16KB', () => {
    let l = emptySurpriseLedger()
    const ids = Array.from({ length: 24 }, (_, i) => `a1111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    for (let i = 0; i < 40; i++) {
      l = applySurpriseEvent(l, { ...ev(`big${i}`), refs: { beliefIds: ids, memoryIds: ids } }, NOW).state!
    }
    expect(JSON.stringify(l).length).toBeLessThanOrEqual(SURPRISE_MAX_BYTES)
    expect(l.events.at(-1)!.key).toBe('big39')
    expect(l.events.length).toBeLessThan(40)
    expect(kairosSurpriseLedgerSchema.safeParse(l).success).toBe(true)
  })
})

describe('recordSurprise', () => {
  it('stores once per key and returns the stored event both times', async () => {
    const box = storeWith(emptySurpriseLedger())
    const a = await recordSurprise('u1', ev('k1'), { now: NOW })
    const b = await recordSurprise('u1', { ...ev('k1'), s: 0.9 }, { now: NOW })
    expect(a).not.toBeNull()
    expect(b).toEqual(a)
    expect(box.ledger.events).toHaveLength(1)
  })

  it('never throws: a DB failure or bad input returns null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(mutateKairosSurprise).mockRejectedValue(new Error('boom'))
    expect(await recordSurprise('u1', ev('k1'), { now: NOW })).toBeNull()
    storeWith(emptySurpriseLedger())
    expect(await recordSurprise('u1', { key: '', kind: 'aha', s: 0.3 }, { now: NOW })).toBeNull()
  })

  it('loadSurpriseLedger falls back to empty on a read failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(readKairosSurprise).mockRejectedValue(new Error('corrupt'))
    expect(await loadSurpriseLedger('u1')).toEqual(emptySurpriseLedger())
  })
})

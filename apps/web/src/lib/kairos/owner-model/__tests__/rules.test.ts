import { describe, expect, it, vi } from 'vitest'

// rules.ts imports BackUp's thresholds; BackUp's data module is not needed.
vi.mock('@/lib/data/memory-candidates', () => ({}))

import { PROMOTE_MIN_DAYS, PROMOTE_MIN_SUPPORTS } from '@/lib/kairos/engine/steps/back-up'
import type { KairosOwnerModel, OwnerItem } from '@/lib/data/validators/kairos-owner-model'
import { mergeOwnerExtraction, applyOwnerCorrection, type ProvenanceInfo } from '../mutations'
import { pruneOwnerModel, shouldPromoteTrait } from '../rules'
import { effectiveStatus, emptyOwnerModel, isActionable, isLive, isVetoed, stateExpiry } from '../status'
import { mentionsHealth } from '../text'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const DAY = 86_400_000
const TTL = 10
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString()

function state(seq: number, lastConfirmedDaysAgo: number, extra: Partial<OwnerItem> = {}): OwnerItem {
  const last = iso(-lastConfirmedDaysAgo)
  return {
    id: `id-${seq}`, seq, kind: 'state', text: `state number ${seq} about the launch`, domain: 'general', status: 'held',
    firstSeenAt: last, lastConfirmedAt: last, expiresAt: stateExpiry(last, TTL), supportDays: [], confirmations: [], ...extra,
  }
}

function trait(seq: number, extra: Partial<OwnerItem> = {}): OwnerItem {
  return {
    id: `id-${seq}`, seq, kind: 'trait', text: 'values directness in feedback', domain: 'general', status: 'candidate',
    firstSeenAt: iso(-3), lastConfirmedAt: iso(-3), supportDays: [], confirmations: [], ...extra,
  }
}

const model = (items: OwnerItem[], extra: Partial<KairosOwnerModel> = {}): KairosOwnerModel =>
  ({ ...emptyOwnerModel(), nextSeq: items.length + 1, items, ...extra })

const info = (entries: Array<[string, ProvenanceInfo['origin'], string]>) =>
  new Map(entries.map(([id, origin, at]) => [id, { origin, createdAt: new Date(at) }]))

describe('state lifetime', () => {
  it('lapses at exactly expiresAt and is live 1 ms before', () => {
    const s = state(1, 0, { expiresAt: NOW.toISOString() })
    expect(effectiveStatus(s, NOW)).toBe('expired')
    expect(isLive(s, new Date(NOW.getTime() - 1))).toBe(true)
  })

  it('a stale-provenance re-confirm does nothing; a newer one moves the clock to his words', () => {
    const s = state(1, 2)
    const stale = mergeOwnerExtraction(model([s]), { states: [{ text: 'x', provenance: ['m1'], relation: 'reconfirms', targetSeq: 1 }], traits: [] },
      info([['m1', 'operator', iso(-5)]]), NOW, TTL)
    expect(stale.items[0]).toEqual(s)
    const fresh = mergeOwnerExtraction(model([s]), { states: [{ text: 'x', provenance: ['m2'], relation: 'reconfirms', targetSeq: 1 }], traits: [] },
      info([['m2', 'operator', iso(-1)]]), NOW, TTL)
    expect(fresh.items[0]!.lastConfirmedAt).toBe(iso(-1))
    expect(fresh.items[0]!.expiresAt).toBe(stateExpiry(iso(-1), TTL))
  })

  it('a new state needs an operator or kairos-origin provenance and is created live', () => {
    const ext = { states: [{ text: 'stressed about the launch', provenance: ['a'], relation: 'new' as const, targetSeq: null }], traits: [] }
    expect(mergeOwnerExtraction(model([]), ext, info([['a', 'agent', iso(-1)]]), NOW, TTL).items).toHaveLength(0)
    const out = mergeOwnerExtraction(model([]), ext, info([['a', 'kairos', iso(-1)]]), NOW, TTL)
    expect(out.items[0]).toMatchObject({ seq: 1, kind: 'state', status: 'held', lastConfirmedAt: iso(-1) })
    expect(out.nextSeq).toBe(2)
    expect(out.lastExtractAt).toBe(NOW.toISOString())
  })

  it('owner still / over / wrong, and revival within 7 days', () => {
    const opts = { via: 'telegram' as const, now: NOW, ttlDays: TTL }
    const kept = applyOwnerCorrection(model([state(1, 3)]), { seq: 1 }, 'still', opts)
    expect(kept.result).toMatchObject({ ok: true, label: `C1 kept to ${'14/10'} ✓` })
    expect(kept.state!.items[0]).toMatchObject({ lastConfirmedAt: NOW.toISOString(), status: 'held' })

    const over = applyOwnerCorrection(model([state(1, 3)]), { seq: 1 }, 'over', opts)
    expect(over.state!.items[0]).toMatchObject({ status: 'ended', retiredReason: 'owner_over' })
    expect(over.state!.vetoes).toHaveLength(0)

    const wrong = applyOwnerCorrection(model([state(1, 3)]), { seq: 1 }, 'wrong', opts)
    expect(wrong.state!.items[0]).toMatchObject({ status: 'retired', retiredReason: 'owner_wrong' })
    expect(wrong.state!.vetoes[0]).toMatchObject({ kind: 'state', until: iso(30) })

    const lapsed = state(1, 15) // expired 5 days ago
    expect(isActionable(lapsed, NOW)).toBe(true)
    expect(applyOwnerCorrection(model([lapsed]), { seq: 1 }, 'still', opts).state!.items[0]!.status).toBe('held')
    const gone = state(1, 18) // expired 8 days ago
    expect(applyOwnerCorrection(model([gone]), { seq: 1 }, 'still', opts).result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('dedups a Telegram redelivery by update id', () => {
    const opts = { via: 'telegram' as const, now: NOW, ttlDays: TTL, updateId: 77 }
    const first = applyOwnerCorrection(model([state(1, 3)]), { seq: 1 }, 'still', opts)
    expect(applyOwnerCorrection(first.state!, { seq: 1 }, 'over', opts)).toEqual({ state: null, result: { ok: false, reason: 'duplicate' } })
  })
})

describe('vetoes', () => {
  it('block re-extraction until `until`', () => {
    const vetoed = model([], { vetoes: [{ norm: 'stressed about the launch', kind: 'state', until: iso(2) }] })
    const ext = { states: [{ text: 'Stressed about the launch!', provenance: ['a'], relation: 'new' as const, targetSeq: null }], traits: [] }
    expect(isVetoed(vetoed, 'state', 'stressed about launch', NOW)).toBe(true)
    expect(mergeOwnerExtraction(vetoed, ext, info([['a', 'operator', iso(-1)]]), NOW, TTL).items).toHaveLength(0)
    const later = new Date(NOW.getTime() + 3 * DAY)
    expect(mergeOwnerExtraction(vetoed, ext, info([['a', 'operator', iso(2.5)]]), later, TTL).items).toHaveLength(1)
  })
})

describe('trait promotion (BackUp thresholds)', () => {
  it('uses the imported thresholds', () => {
    expect([PROMOTE_MIN_SUPPORTS, PROMOTE_MIN_DAYS]).toEqual([2, 2])
  })

  it('promotes at 2 confirmations on 2 days with 1 anchored, not at 2 on the same day', () => {
    const c = (at: string, anchored: boolean) => ({ at, via: 'extract' as const, memoryIds: ['m'], anchored })
    expect(shouldPromoteTrait(trait(1, { confirmations: [c(iso(-2), true), c(iso(-1), false)] }))).toBe(true)
    expect(shouldPromoteTrait(trait(1, { confirmations: [c(iso(-1), true), c(new Date(NOW.getTime() - DAY + 60_000).toISOString(), true)] }))).toBe(false)
    expect(shouldPromoteTrait(trait(1, { confirmations: [c(iso(-2), false), c(iso(-1), false)] }))).toBe(false)
  })

  it('a supporting extraction on a second day promotes; an owner yes promotes at once', () => {
    const first = mergeOwnerExtraction(model([]), { states: [], traits: [{ text: 'values directness', provenance: ['a'], relation: 'new', targetSeq: null }] },
      info([['a', 'operator', iso(-2)]]), NOW, TTL)
    expect(first.items[0]!.status).toBe('candidate')
    const second = mergeOwnerExtraction(first, { states: [], traits: [{ text: 'x', provenance: ['b'], relation: 'supports', targetSeq: 1 }] },
      info([['b', 'kairos', iso(-1)]]), NOW, TTL)
    expect(second.items[0]!.status).toBe('held')
    const yes = applyOwnerCorrection(first, { seq: 1 }, 'still', { via: 'session', now: NOW, ttlDays: TTL })
    expect(yes.state!.items[0]!.status).toBe('held')
  })

  it('retires a candidate with no new support in 21 days', () => {
    const stale = trait(1, { lastConfirmedAt: iso(-22) })
    expect(pruneOwnerModel(model([stale]), NOW).items[0]).toMatchObject({ status: 'retired', retiredReason: 'expired' })
  })
})

describe('caps and pruning', () => {
  it('takes at most 4 states and 3 traits per night', () => {
    const moods = ['tired after travel', 'excited about hiring', 'worried over money', 'restless at weekends', 'proud of shipping', 'curious about music']
    const habits = ['writes things down', 'prefers mornings', 'hates meetings', 'reads widely', 'walks daily']
    const states = moods.map((text, i) => ({ text, provenance: [`s${i}`], relation: 'new' as const, targetSeq: null }))
    const traits = habits.map((text, i) => ({ text, provenance: [`t${i}`], relation: 'new' as const, targetSeq: null }))
    const rows = info([...states.map((s) => [s.provenance[0], 'operator', iso(-1)] as [string, 'operator', string]), ...traits.map((t) => [t.provenance[0], 'operator', iso(-1)] as [string, 'operator', string])])
    const out = mergeOwnerExtraction(model([]), { states, traits }, rows, NOW, TTL)
    expect(out.items.filter((i) => i.kind === 'state')).toHaveLength(4)
    expect(out.items.filter((i) => i.kind === 'trait')).toHaveLength(3)
  })

  it('saves lapsed states as expired and prunes them 30 days later', () => {
    const pruned = pruneOwnerModel(model([state(1, 12), state(2, 41)]), NOW)
    expect(pruned.items.map((i) => [i.seq, i.status])).toEqual([[1, 'expired']])
  })
})

describe('health terms', () => {
  it('flags clinical labels, not ordinary moods', () => {
    expect(mentionsHealth('seems depressed lately')).toBe(true)
    expect(mentionsHealth('probably has ADHD')).toBe(true)
    expect(mentionsHealth('stressed about the launch')).toBe(false)
  })
})

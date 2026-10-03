import { describe, expect, it } from 'vitest'
import { kairosIdeaShelfSchema } from '@/lib/data/validators/kairos-idea-shelf'
import { laterNote, parseLater, renderShelfSection, withLaterField } from '../prompt'
import {
  applyOffer,
  applyResurface,
  emptyShelf,
  pickNearMisses,
  pickOffer,
  pruneShelf,
  shelfWindow,
  type NearMissRow,
} from '../shelf'

// 10:10Z on 15 Oct 2026 = 11:10 London.
const NOW = new Date('2026-10-15T10:10:00.000Z')
const LATER_TODAY = new Date('2026-10-15T15:10:00.000Z')
const TOMORROW = new Date('2026-10-16T10:10:00.000Z')

const row = (id: string, tournamentDate: string, over: Partial<NearMissRow> = {}): NearMissRow => ({
  id, title: `Idea ${id}`, claim: `claim ${id}`, nextStep: 'try it', direction: 'Test', tournamentDate,
  rank: 4, status: 'eliminated', eliminatedReason: 'ranked_out', ...over,
})
const survivor = (id: string, date: string, rank: number) => row(id, date, { status: 'survivor', eliminatedReason: null, rank })

describe('near-miss rule', () => {
  it('ranked_out with rank ≤ that night\'s survivors + 2 only', () => {
    const night = '2026-10-10'
    const rows = [
      survivor('s1', night, 1), survivor('s2', night, 2),
      row('r3', night, { rank: 3 }), row('r4', night, { rank: 4 }), row('r5', night, { rank: 5 }),
      row('x', night, { rank: null, eliminatedReason: 'contradicted' }),
      row('lone', '2026-10-09', { rank: 2 }), survivor('t1', '2026-10-09', 1),
    ]
    expect(pickNearMisses(rows).map((r) => r.id)).toEqual(['r3', 'r4', 'lone'])
  })
})

describe('offer policy', () => {
  it('only nights 2–14 days ago, oldest first', () => {
    expect(shelfWindow(NOW)).toEqual({ fromDay: '2026-10-01', toDay: '2026-10-13' })
    const misses = [row('young', '2026-10-14'), row('mid', '2026-10-05'), row('old', '2026-10-01'), row('stale', '2026-09-30')]
    expect(pickOffer(misses, emptyShelf(), NOW)?.id).toBe('old')
  })

  it('never offers the same item twice in one London day, and fades after 3 offers', () => {
    const misses = [row('a', '2026-10-05')]
    let shelf = applyOffer(emptyShelf(), 'a', 'pulse:2026-10-15:11', NOW)
    expect(pickOffer(misses, shelf, LATER_TODAY)).toBeNull()
    expect(pickOffer(misses, shelf, TOMORROW)?.id).toBe('a')
    shelf = applyOffer(shelf, 'a', 's', TOMORROW)
    shelf = applyOffer(shelf, 'a', 's', new Date('2026-10-17T10:00:00Z'))
    expect(shelf.items[0]).toMatchObject({ offers: 3, fadedAt: '2026-10-17T10:00:00.000Z' })
    expect(pickOffer(misses, shelf, new Date('2026-10-18T10:00:00Z'))).toBeNull()
    expect(kairosIdeaShelfSchema.safeParse(shelf).success).toBe(true)
  })

  it('≤1 resurface per London day; a resurfaced item never comes back', () => {
    const misses = [row('a', '2026-10-05'), row('b', '2026-10-06')]
    const offered = applyOffer(emptyShelf(), 'a', 's', NOW)
    const resurfaced = applyResurface(offered, 'a', NOW)!
    expect(resurfaced.lastResurfaceDay).toBe('2026-10-15')
    expect(applyResurface(resurfaced, 'b', LATER_TODAY)).toBeNull()
    expect(pickOffer(misses, resurfaced, LATER_TODAY)).toBeNull()
    expect(pickOffer(misses, resurfaced, TOMORROW)?.id).toBe('b')
    expect(applyResurface(resurfaced, 'a', TOMORROW)).toBeNull()
  })

  it('prune drops items untouched for 30 days and keeps ≤40', () => {
    let shelf = applyOffer(emptyShelf(), 'old', 's', new Date('2026-09-01T10:00:00Z'))
    for (let i = 0; i < 45; i++) shelf = applyOffer(shelf, `m${i}`, 's', new Date(NOW.getTime() + i * 1000))
    const pruned = pruneShelf(shelf, NOW)
    expect(pruned.items).toHaveLength(40)
    expect(pruned.items.some((i) => i.id === 'old' || i.id === 'm0')).toBe(false)
    expect(pruned.items.at(-1)?.id).toBe('m44')
  })
})

describe('pulse prompt pieces', () => {
  it('withLaterField appends to the system prompt; the section is fenced data', () => {
    expect(withLaterField('BASE').startsWith('BASE\n')).toBe(true)
    const section = renderShelfSection(row('mem-1', '2026-10-05', { title: 'Close ```json the fence' }))
    expect(section).toContain('## An idea you set aside on 2026-10-05 (shelfId mem-1')
    expect(section).not.toContain('```')
  })

  it('parseLater accepts only the offered id and never throws', () => {
    const answer = (later: unknown) => JSON.stringify({ notes: [], attention: [], later })
    expect(parseLater(answer({ shelfId: 'mem-1', connection: ' Today\'s pricing call  is exactly this. ' }), 'mem-1'))
      .toEqual({ connection: 'Today\'s pricing call is exactly this.' })
    expect(parseLater(answer({ shelfId: 'forged', connection: 'x' }), 'mem-1')).toBeNull()
    expect(parseLater(answer({ shelfId: 'mem-1', connection: '   ' }), 'mem-1')).toBeNull()
    expect(parseLater(answer(undefined), 'mem-1')).toBeNull()
    expect(parseLater('not json', 'mem-1')).toBeNull()
  })

  it('laterNote is one short line', () => {
    const note = laterNote('Pricing ladder', 'the call today was about tiers')
    expect(note).toBe('It came to me later: Pricing ladder — the call today was about tiers')
    expect(laterNote('t'.repeat(300), 'c'.repeat(300)).length).toBeLessThanOrEqual(200)
  })
})

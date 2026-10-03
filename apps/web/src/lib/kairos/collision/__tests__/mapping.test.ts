import { describe, expect, it } from 'vitest'
import { blendOf, checkStructure, parseBlends, type Blend } from '../mapping'

const TEXT_A = 'Standup ritual — Morning standup blocks deep work and meetings fragment deep work'
const TEXT_B = 'Garden notes — Weeds crowd seedlings and shade starves seedlings'

const good = (): Blend => ({
  pair: 'p1',
  holds: true,
  a: [{ rel: 'blocks', x: 'standup', y: 'deep work' }, { rel: 'fragments', x: 'meetings', y: 'deep work' }],
  b: [{ rel: 'crowds', x: 'weeds', y: 'seedlings' }, { rel: 'starves', x: 'shade', y: 'seedlings' }],
  map: [{ a: 'standup', b: 'weeds' }, { a: 'deep work', b: 'seedlings' }, { a: 'meetings', b: 'shade' }],
  insight: 'Protect focus like seedlings: clear what crowds it before adding more.',
})

describe('checkStructure', () => {
  it('passes a consistent, connected, grounded mapping', () => {
    const res = checkStructure(good(), TEXT_A, TEXT_B)
    expect(res).toEqual({
      ok: true,
      relations: [
        { a: 'standup blocks deep work', b: 'weeds crowds seedlings' },
        { a: 'meetings fragments deep work', b: 'shade starves seedlings' },
      ],
    })
  })

  it('normalises case and spacing when matching', () => {
    const b = good()
    b.b[0] = { rel: 'crowds', x: 'Weeds', y: '  Seedlings ' }
    expect(checkStructure(b, TEXT_A, TEXT_B).ok).toBe(true)
  })

  const fails = (mutate: (b: Blend) => void, a = TEXT_A, bText = TEXT_B) => {
    const b = good()
    mutate(b)
    const res = checkStructure(b, a, bText)
    return res.ok ? 'ok' : res.reason
  }

  it('rejects a declined blend', () => expect(fails((b) => { b.holds = false })).toBe('declined'))
  it('rejects too few relations', () => expect(fails((b) => { b.a = b.a.slice(0, 1) })).toBe('relation_count'))
  it('rejects too many relations', () => expect(fails((b) => { b.b = Array.from({ length: 7 }, () => b.b[0]) })).toBe('relation_count'))
  it('rejects a one-entity relation', () => expect(fails((b) => { b.a[0] = { rel: 'is', x: 'standup', y: 'Standup' } })).toBe('relation_shape'))
  it('rejects a mapping that is not one-to-one', () => {
    expect(fails((b) => { b.map.push({ a: 'standup', b: 'soil' }) })).toBe('map_not_one_to_one')
    expect(fails((b) => { b.map.push({ a: 'calendar', b: 'weeds' }) })).toBe('map_not_one_to_one')
    expect(fails((b) => { b.map = [] })).toBe('map_not_one_to_one')
  })
  it('needs two parallel relations', () => {
    expect(fails((b) => { b.b[1] = { rel: 'starves', x: 'seedlings', y: 'shade' } })).toBe('parallel_connectivity')
  })
  it('needs the matched relations to share entities', () => {
    expect(fails((b) => {
      b.a = [{ rel: 'blocks', x: 'standup', y: 'deep work' }, { rel: 'fragments', x: 'meetings', y: 'calendar' }]
      b.b = [{ rel: 'crowds', x: 'weeds', y: 'seedlings' }, { rel: 'starves', x: 'shade', y: 'roots' }]
      b.map = [{ a: 'standup', b: 'weeds' }, { a: 'deep work', b: 'seedlings' }, { a: 'meetings', b: 'shade' }, { a: 'calendar', b: 'roots' }]
    }, `${TEXT_A} calendar`, `${TEXT_B} roots`)).toBe('not_systematic')
  })
  it('rejects a mapping of look-alike labels', () => {
    expect(fails((b) => {
      b.a = [{ rel: 'blocks', x: 'weeds', y: 'seedlings' }, { rel: 'starves', x: 'shade', y: 'seedlings' }]
      b.map = [{ a: 'weeds', b: 'weeds' }, { a: 'seedlings', b: 'seedlings' }, { a: 'shade', b: 'shade' }]
    }, TEXT_B, TEXT_B)).toBe('surface_match')
  })
  it('needs entity words from each memory', () => {
    expect(fails(() => {}, 'Something unrelated entirely', TEXT_B)).toBe('ungrounded_entities')
    expect(fails(() => {}, TEXT_A, 'Nothing in common here')).toBe('ungrounded_entities')
  })
  it('needs an insight', () => expect(fails((b) => { b.insight = '' })).toBe('no_insight'))
})

describe('parseBlends / blendOf', () => {
  it('keeps the first valid blend per pair and tolerates junk', () => {
    const raw = { blends: [{ pair: 'p1', holds: false }, good(), { nope: true }, { ...good(), pair: 'p2' }] }
    const map = parseBlends(raw)
    expect([...map.keys()]).toEqual(['p1', 'p2'])
    expect(map.get('p1')?.holds).toBe(false)
    expect(parseBlends(null).size).toBe(0)
    expect(parseBlends({ blends: 'x' }).size).toBe(0)
  })

  it('reads a candidate blend id', () => {
    expect(blendOf({ blend: ' p1 ' })).toBe('p1')
    expect(blendOf({ blend: '' })).toBeNull()
    expect(blendOf({ blend: 3 })).toBeNull()
    expect(blendOf(undefined)).toBeNull()
  })
})

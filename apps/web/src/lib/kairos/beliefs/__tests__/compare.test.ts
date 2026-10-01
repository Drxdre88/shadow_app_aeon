import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import {
  CompareGroundingError,
  SAME_TOPIC_COSINE,
  pairBeliefsByCosine,
  parseCompareText,
  type EmbeddedBelief,
} from '../compare'
import { cosine } from '../cosine'

const vec = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 4, maxLength: 4 })
const beliefs = (prefix: string) =>
  fc.array(fc.option(vec, { nil: null }), { maxLength: 8 })
    .map((vs) => vs.map((embedding, i): EmbeddedBelief => ({ id: `${prefix}${i}`, embedding })))

describe('pairBeliefsByCosine', () => {
  test.prop([beliefs('a'), beliefs('o')])('pairs are one-to-one, above threshold, and partition both minds', (aligned, own) => {
    const r = pairBeliefsByCosine(aligned, own)
    const pa = r.pairs.map((p) => p.alignedId)
    const po = r.pairs.map((p) => p.ownId)
    expect(new Set(pa).size).toBe(pa.length)
    expect(new Set(po).size).toBe(po.length)
    for (const p of r.pairs) expect(p.similarity).toBeGreaterThanOrEqual(SAME_TOPIC_COSINE)
    expect(new Set([...pa, ...r.alignedOnly])).toEqual(new Set(aligned.map((b) => b.id)))
    expect(new Set([...po, ...r.ownOnly])).toEqual(new Set(own.map((b) => b.id)))
    expect(pa.filter((id) => r.alignedOnly.includes(id))).toEqual([])
    expect(po.filter((id) => r.ownOnly.includes(id))).toEqual([])
  })

  test.prop([beliefs('a'), beliefs('o')])('unembedded beliefs are always one-sided', (aligned, own) => {
    const r = pairBeliefsByCosine(aligned, own)
    const paired = new Set(r.pairs.flatMap((p) => [p.alignedId, p.ownId]))
    for (const b of [...aligned, ...own]) if (!b.embedding) expect(paired.has(b.id)).toBe(false)
  })

  test.prop([beliefs('a'), beliefs('o')])('is maximal: no leftover cross pair still clears the threshold', (aligned, own) => {
    const r = pairBeliefsByCosine(aligned, own)
    const byId = new Map([...aligned, ...own].map((b) => [b.id, b.embedding]))
    for (const a of r.alignedOnly) {
      for (const o of r.ownOnly) {
        const va = byId.get(a)
        const vo = byId.get(o)
        if (va && vo) expect(cosine(va, vo)).toBeLessThan(SAME_TOPIC_COSINE)
      }
    }
  })

  it('takes the strongest match first (greedy by descending cosine)', () => {
    const r = pairBeliefsByCosine(
      [{ id: 'a1', embedding: [1, 0.3] }, { id: 'a2', embedding: [1, 0] }],
      [{ id: 'o1', embedding: [1, 0] }],
    )
    expect(r.pairs).toEqual([{ alignedId: 'a2', ownId: 'o1', similarity: 1 }])
    expect(r.alignedOnly).toEqual(['a1'])
    expect(r.ownOnly).toEqual([])
  })

  it('does not pair different topics', () => {
    const r = pairBeliefsByCosine([{ id: 'a', embedding: [1, 0] }], [{ id: 'o', embedding: [0, 1] }])
    expect(r).toEqual({ pairs: [], alignedOnly: ['a'], ownOnly: ['o'] })
  })
})

describe('parseCompareText (grounding)', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const O = 'bbbbbbbb-0000-4000-8000-000000000002'
  const A2 = 'cccccccc-0000-4000-8000-000000000003'
  const O2 = 'dddddddd-0000-4000-8000-000000000004'
  const pairing = { pairs: [{ alignedId: A, ownId: O, similarity: 0.9 }], alignedOnly: [A2], ownOnly: [O2] }
  const text = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

  it('keeps only listed pairs and one-sided ids from the matching list', () => {
    const out = parseCompareText(text({
      pairs: [
        { alignedId: A.slice(0, 8), ownId: `[${O}]`, verdict: 'diverge', note: 'Different priorities' },
        { alignedId: A, ownId: O2, verdict: 'agree', note: 'not a listed pair' },
        { alignedId: A, ownId: O, verdict: 'agree', note: 'duplicate label' },
      ],
      alignedOnly: [A2, O2, 'invented'],
      ownOnly: [O2, A],
    }), pairing)
    expect(out).toEqual({
      pairs: [{ alignedId: A, ownId: O, verdict: 'diverge', note: 'Different priorities' }],
      alignedOnly: [A2],
      ownOnly: [O2],
    })
  })

  it('rejects an answer that labels none of the listed pairs', () => {
    expect(() => parseCompareText(text({ pairs: [{ alignedId: 'x', ownId: 'y', verdict: 'agree', note: 'n' }] }), pairing))
      .toThrow(CompareGroundingError)
  })

  it('rejects an unknown verdict', () => {
    expect(() => parseCompareText(text({ pairs: [{ alignedId: A, ownId: O, verdict: 'meh', note: 'n' }] }), pairing)).toThrow()
  })

  it('accepts no pairs when none were planned', () => {
    const out = parseCompareText(text({ pairs: [], alignedOnly: [A2], ownOnly: [] }), { pairs: [], alignedOnly: [A2], ownOnly: [] })
    expect(out).toEqual({ pairs: [], alignedOnly: [A2], ownOnly: [] })
  })
})

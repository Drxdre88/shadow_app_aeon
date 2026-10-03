import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { decideReplace, decideRetire, latestSignalAt, openWhy, withPressureBump } from '../gate'
import type { SurpriseMode } from '../flag'
import { readSurpriseMark } from '../marks'
import { detectAha } from '../aha'

const NOW = new Date('2026-10-03T02:00:00.000Z')
const DAY = 86_400_000

describe('decideReplace', () => {
  test.prop([fc.constantFrom<SurpriseMode>('off', 'observe', 'on'), fc.boolean()])(
    'INVARIANT: an operator-provenance replace is never gated, in any mode, open or not',
    (mode, open) => {
      const v = decideReplace(mode, 'operator', open)
      expect(v.allow).toBe(true)
      expect(v.wouldGate).toBe(false)
    },
  )

  it('gates a closed non-operator replace only with the gate on; observe only flags it', () => {
    expect(decideReplace('on', 'tool', false)).toEqual({ allow: false, wouldGate: true, ownerCorrection: false })
    expect(decideReplace('on', 'inference', false)).toMatchObject({ allow: false, wouldGate: true })
    expect(decideReplace('observe', 'tool', false)).toEqual({ allow: true, wouldGate: true, ownerCorrection: false })
    expect(decideReplace('on', 'tool', true)).toEqual({ allow: true, wouldGate: false, ownerCorrection: false })
  })

  it('off changes nothing and records no owner correction', () => {
    expect(decideReplace('off', 'tool', false)).toEqual({ allow: true, wouldGate: false, ownerCorrection: false })
    expect(decideReplace('off', 'operator', false).ownerCorrection).toBe(false)
    expect(decideReplace('on', 'operator', false).ownerCorrection).toBe(true)
  })
})

describe('decideRetire', () => {
  it('flagged always; open only with the gate on', () => {
    expect(decideRetire('off', true, false)).toBe(true)
    expect(decideRetire('off', false, true)).toBe(false)
    expect(decideRetire('observe', false, true)).toBe(false)
    expect(decideRetire('on', false, true)).toBe(true)
    expect(decideRetire('on', false, false)).toBe(false)
  })
})

describe('withPressureBump', () => {
  it('starts a closed, readable mark on an unmarked row and keeps other metadata', () => {
    const next = withPressureBump({ kind: 'belief', belief: { claim: 'x' }, engine: { vetoes: {} } }, NOW)
    expect(next).toMatchObject({ kind: 'belief', belief: { claim: 'x' }, engine: { vetoes: {} } })
    const mark = readSurpriseMark(next)
    expect(mark?.pressure).toEqual({ n: 1, since: NOW.toISOString() })
    expect(Date.parse(mark!.openUntil)).toBeLessThan(NOW.getTime())
  })

  it('counts up within 14 days and restarts after', () => {
    const fresh = { engine: { surprise: { openUntil: '2026-10-01T07:00:00.000Z', signals: [], pressure: { n: 1, since: new Date(NOW.getTime() - 3 * DAY).toISOString() } } } }
    expect(readSurpriseMark(withPressureBump(fresh, NOW))?.pressure?.n).toBe(2)
    const stale = { engine: { surprise: { openUntil: '2026-09-01T07:00:00.000Z', signals: [], pressure: { n: 5, since: new Date(NOW.getTime() - 15 * DAY).toISOString() } } } }
    expect(readSurpriseMark(withPressureBump(stale, NOW))?.pressure).toEqual({ n: 1, since: NOW.toISOString() })
  })
})

describe('openWhy / latestSignalAt', () => {
  const meta = { engine: { surprise: { openUntil: '2026-10-04T07:00:00.000Z', signals: [
    { kind: 'prediction_wrong', ref: 'p', at: '2026-10-02T10:00:00.000Z', s: 0.7 },
    { kind: 'owner_correction', ref: 'c', at: '2026-10-02T12:00:00.000Z', s: 0.5 },
  ] } } }

  it('turns signal kinds into plain words, never ids', () => {
    const why = openWhy(meta)
    expect(why).toContain('prediction')
    expect(why).toContain('operator corrected')
    expect(why).not.toMatch(/\bp\b|\bc\b/)
    expect(openWhy({})).toBe('a surprising event touched it')
  })

  it('reads the newest signal instant', () => {
    expect(latestSignalAt(meta)).toBe(Date.parse('2026-10-02T12:00:00.000Z'))
    expect(latestSignalAt({})).toBeNull()
  })
})

describe('detectAha', () => {
  const base = { extractKey: 'belief_extract:2026-10-03', inputIds: ['in-1', 'in-2'], questionedIds: ['q-1'], reinforced: [], replaced: [] }

  it('bridge: one new input reinforcing two distinct beliefs', () => {
    const out = detectAha({ ...base, reinforced: [{ targetId: 'b-1', provenance: ['in-1'] }, { targetId: 'b-2', provenance: ['in-1', 'old'] }] })
    expect(out).toEqual([expect.objectContaining({ kind: 'aha', key: 'aha:belief_extract:2026-10-03:bridge:in-1', refs: { beliefIds: ['b-1', 'b-2'], memoryIds: ['in-1'] } })])
  })

  it('no aha for one belief, or for old evidence shared by two', () => {
    expect(detectAha({ ...base, reinforced: [{ targetId: 'b-1', provenance: ['in-1'] }, { targetId: 'b-1', provenance: ['in-1'] }] })).toEqual([])
    expect(detectAha({ ...base, reinforced: [{ targetId: 'b-1', provenance: ['old'] }, { targetId: 'b-2', provenance: ['old'] }] })).toEqual([])
  })

  it('resolve: a replace of a questioned belief', () => {
    const out = detectAha({ ...base, replaced: [{ targetId: 'q-1', newId: 'n-1', provenance: ['in-2'] }, { targetId: 'x', newId: 'n-2', provenance: [] }] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'aha:belief_extract:2026-10-03:resolve:q-1', refs: { beliefIds: ['q-1', 'n-1'] } })
  })
})

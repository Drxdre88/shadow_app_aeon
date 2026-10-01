import { describe, expect, it } from 'vitest'
import {
  beliefSourceTypeFromProvenance,
  capBeliefConfidence,
  derivedOriginKind,
  inferOriginKind,
  mayShapeBeliefs,
  originKindOf,
  readOrigin,
} from '../origin'

describe('origin', () => {
  it('reads a stored label and ignores junk', () => {
    expect(readOrigin({ origin: { kind: 'operator', via: 'ui' } })).toEqual({ kind: 'operator', via: 'ui' })
    expect(readOrigin({ origin: { kind: 'boss' } })).toBeNull()
    expect(readOrigin(null)).toBeNull()
  })

  it('infers unlabelled rows conservatively', () => {
    expect(inferOriginKind('manual')).toBe('operator')
    expect(inferOriginKind('claude')).toBe('agent')
    expect(inferOriginKind('cron')).toBe('kairos')
    expect(inferOriginKind('cron', { kind: 'board_day' })).toBe('activity')
    expect(inferOriginKind('webhook')).toBe('external')
    expect(inferOriginKind(undefined)).toBe('external')
  })

  it('prefers the stored label over inference', () => {
    expect(originKindOf({ source: 'manual', sourceMetadata: { origin: { kind: 'agent' } } })).toBe('agent')
  })

  it('derived rows take the lowest-trust input and never beat kairos', () => {
    expect(derivedOriginKind(['operator', 'operator'])).toBe('kairos')
    expect(derivedOriginKind(['operator', 'external'])).toBe('external')
    expect(derivedOriginKind([])).toBe('kairos')
  })

  it('one operator support makes a belief the operator view', () => {
    expect(beliefSourceTypeFromProvenance(['kairos', 'operator'])).toBe('operator')
    expect(beliefSourceTypeFromProvenance(['kairos', 'agent'])).toBe('tool')
    expect(beliefSourceTypeFromProvenance(['kairos', 'external'])).toBe('inference')
  })

  it('caps model confidence by source type', () => {
    expect(capBeliefConfidence(0.99, 'inference')).toBe(0.6)
    expect(capBeliefConfidence(0.5, 'operator')).toBe(0.5)
    expect(capBeliefConfidence(Number.NaN, 'tool')).toBe(0)
  })

  it('external content can never shape beliefs', () => {
    expect(mayShapeBeliefs('external')).toBe(false)
    expect(mayShapeBeliefs('kairos')).toBe(true)
  })
})

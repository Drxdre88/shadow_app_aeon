import { describe, it, expect } from 'vitest'
import { defaultStreamClass, deriveValidAt } from '../stream-class-default'
import { CONFIDENCE_BY_STREAM, confidenceForStreamClass } from '../confidence'
import { META_STREAM_CLASSES, STREAM_CLASSES } from '../streamClass'

describe('defaultStreamClass — capture choke point', () => {
  it('classifies reflections as reflection regardless of source', () => {
    expect(defaultStreamClass('manual', 'reflection')).toBe('reflection')
    expect(defaultStreamClass('cron', 'reflection')).toBe('reflection')
  })

  it.each(['claude', 'codex', 'copilot', 'hook'])('classifies a %s session_summary as agentic', (source) => {
    expect(defaultStreamClass(source, 'session_summary', { sessionId: 's1' })).toBe('agentic')
  })

  it('demotes a Hangar mission transcript to execution so it does not double-weight the mission memory', () => {
    expect(defaultStreamClass('claude', 'session_summary', { session: { hangarSessionId: 'hs-1' } })).toBe('execution')
  })

  it('ignores an empty or non-string hangarSessionId', () => {
    expect(defaultStreamClass('claude', 'session_summary', { session: { hangarSessionId: '' } })).toBe('agentic')
    expect(defaultStreamClass('claude', 'session_summary', { session: { hangarSessionId: '   ' } })).toBe('agentic')
    expect(defaultStreamClass('codex', 'session_summary', { session: { hangarSessionId: 42 } })).toBe('agentic')
    expect(defaultStreamClass('codex', 'session_summary', { session: 'hs-1' })).toBe('agentic')
  })

  it('does not treat a session_summary from a non-agent source as agentic', () => {
    expect(defaultStreamClass('manual', 'session_summary')).toBeUndefined()
    expect(defaultStreamClass('cron', 'session_summary')).toBe('execution')
  })

  it('classifies snapshots as snapshot', () => {
    expect(defaultStreamClass('system', 'snapshot')).toBe('snapshot')
    expect(defaultStreamClass('manual', 'snapshot')).toBe('snapshot')
  })

  it('classifies system achievements/observations as execution', () => {
    expect(defaultStreamClass('system', 'achievement')).toBe('execution')
    expect(defaultStreamClass('system', 'observation')).toBe('execution')
    expect(defaultStreamClass('manual', 'observation')).toBeUndefined()
  })

  it('keeps the WP3 rule: import and cron sources default to execution', () => {
    expect(defaultStreamClass('import', 'note')).toBe('execution')
    expect(defaultStreamClass('cron', 'advisory')).toBe('execution')
  })

  it('returns undefined (DB default idea) for ordinary operator notes', () => {
    expect(defaultStreamClass('manual', 'note')).toBeUndefined()
    expect(defaultStreamClass('voice', 'idea')).toBeUndefined()
    expect(defaultStreamClass('webhook', 'inbound')).toBeUndefined()
    expect(defaultStreamClass('system', 'note')).toBeUndefined()
  })
})

describe('deriveValidAt', () => {
  const now = new Date('2026-09-30T12:00:00Z')

  it('uses a recent past session.endedAt', () => {
    const d = deriveValidAt({ session: { endedAt: '2026-09-29T22:15:00Z' } }, now)
    expect(d?.toISOString()).toBe('2026-09-29T22:15:00.000Z')
  })

  it('accepts exactly 7 days ago but not older', () => {
    expect(deriveValidAt({ session: { endedAt: '2026-09-23T12:00:00Z' } }, now)).toBeInstanceOf(Date)
    expect(deriveValidAt({ session: { endedAt: '2026-09-23T11:59:59Z' } }, now)).toBeUndefined()
  })

  it('rejects future, unparseable, empty, and missing values', () => {
    expect(deriveValidAt({ session: { endedAt: '2026-09-30T12:00:01Z' } }, now)).toBeUndefined()
    expect(deriveValidAt({ session: { endedAt: 'not-a-date' } }, now)).toBeUndefined()
    expect(deriveValidAt({ session: { endedAt: '' } }, now)).toBeUndefined()
    expect(deriveValidAt({ session: {} }, now)).toBeUndefined()
    expect(deriveValidAt({ endedAt: '2026-09-29T22:15:00Z' }, now)).toBeUndefined()
    expect(deriveValidAt(null, now)).toBeUndefined()
  })
})

describe('confidence priors', () => {
  it('has a prior for every stream class', () => {
    for (const sc of STREAM_CLASSES) expect(CONFIDENCE_BY_STREAM[sc]).toBeTypeOf('number')
  })

  it('ranks snapshot lowest and aether with cortex', () => {
    expect(confidenceForStreamClass('snapshot')).toBeLessThan(confidenceForStreamClass('trace'))
    expect(confidenceForStreamClass('aether')).toBe(confidenceForStreamClass('cortex'))
    expect(confidenceForStreamClass('agentic')).toBe(0.45)
    expect(confidenceForStreamClass('execution')).toBe(0.35)
    expect(confidenceForStreamClass('unknown-class')).toBe(0.5)
  })

  it('treats trace, delta and snapshot as meta streams', () => {
    expect([...META_STREAM_CLASSES].sort()).toEqual(['delta', 'snapshot', 'trace'])
  })
})

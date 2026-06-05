import { describe, it, expect } from 'vitest'
import { STREAM_CLASSES, isStreamClass, type StreamClass } from '../streamClass'

describe('STREAM_CLASSES', () => {
  it('exposes the canonical Phase 3 set', () => {
    expect(STREAM_CLASSES).toEqual([
      'idea',
      'agentic',
      'execution',
      'reflection',
      'cortex',
      'archetype',
      'advisory',
      'trace',
    ])
  })
})

describe('isStreamClass', () => {
  it.each([...STREAM_CLASSES])('returns true for canonical value %s', (v) => {
    expect(isStreamClass(v)).toBe(true)
  })

  it.each(['unknown', '', ' idea ', 'Idea', 'IDEA', 'archetypes'])(
    'returns false for non-canonical string %s',
    (v) => {
      expect(isStreamClass(v)).toBe(false)
    },
  )

  it.each([null, undefined, 0, 1, true, false, {}, []])(
    'returns false for non-string input %p',
    (v) => {
      expect(isStreamClass(v)).toBe(false)
    },
  )

  it('narrows the type at the call site', () => {
    const v: unknown = 'cortex'
    if (isStreamClass(v)) {
      const narrowed: StreamClass = v
      expect(narrowed).toBe('cortex')
    } else {
      throw new Error('expected narrow to succeed')
    }
  })
})

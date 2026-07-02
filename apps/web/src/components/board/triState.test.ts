import { describe, it, expect } from 'vitest'
import { nextTriState, triToStatus, getTriState, type TriState } from './triState'

describe('nextTriState', () => {
  it('cycles unchecked → checked → crossed → unchecked', () => {
    expect(nextTriState('unchecked')).toBe('checked')
    expect(nextTriState('checked')).toBe('crossed')
    expect(nextTriState('crossed')).toBe('unchecked')
  })

  it('returns to the start after three steps', () => {
    let s: TriState = 'unchecked'
    s = nextTriState(nextTriState(nextTriState(s)))
    expect(s).toBe('unchecked')
  })
})

describe('triToStatus', () => {
  it('maps checked to done and crossed to todo', () => {
    expect(triToStatus('checked', 'in-progress')).toBe('done')
    expect(triToStatus('crossed', 'in-progress')).toBe('todo')
  })

  it('unchecked keeps the fallback status unless it was done', () => {
    expect(triToStatus('unchecked', 'in-progress')).toBe('in-progress')
    expect(triToStatus('unchecked', 'todo')).toBe('todo')
    expect(triToStatus('unchecked', 'done')).toBe('todo')
  })
})

describe('getTriState', () => {
  it('reads done status as checked regardless of crossed set', () => {
    expect(getTriState('done', {}, 't1')).toBe('checked')
    expect(getTriState('done', { t1: true }, 't1')).toBe('checked')
  })

  it('reads a crossed id as crossed when not done', () => {
    expect(getTriState('todo', { t1: true }, 't1')).toBe('crossed')
  })

  it('reads everything else as unchecked', () => {
    expect(getTriState('todo', {}, 't1')).toBe('unchecked')
    expect(getTriState('in-progress', { other: true }, 't1')).toBe('unchecked')
  })
})

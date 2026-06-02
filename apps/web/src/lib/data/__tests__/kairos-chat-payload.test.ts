import { describe, it, expect } from 'vitest'
import {
  parseRetrievalMeta,
  parseSnapshot,
  hasAnyRetrieval,
  type ChatRetrievalMeta,
} from '../kairos-chat-payload'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('parseSnapshot', () => {
  it('returns null for null / undefined / non-object', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot(undefined)).toBeNull()
    expect(parseSnapshot('string')).toBeNull()
    expect(parseSnapshot(42)).toBeNull()
  })

  it('returns null when id or title is not a string', () => {
    expect(parseSnapshot({ id: 5, title: 't' })).toBeNull()
    expect(parseSnapshot({ id: A, title: 42 })).toBeNull()
    expect(parseSnapshot({ id: A })).toBeNull()
    expect(parseSnapshot({ title: 't' })).toBeNull()
  })

  it('strips unknown fields', () => {
    expect(parseSnapshot({ id: A, title: 't', body: 'extra', kind: 'evil' }))
      .toEqual({ id: A, title: 't' })
  })
})

describe('hasAnyRetrieval', () => {
  it('returns false when every bucket is missing or empty', () => {
    expect(hasAnyRetrieval({})).toBe(false)
    expect(hasAnyRetrieval({ archetypes: [], substrate: [] })).toBe(false)
    expect(hasAnyRetrieval({ cortex: null, archetypes: [], substrate: [] })).toBe(false)
  })

  it('returns true when any bucket carries content', () => {
    expect(hasAnyRetrieval({ cortex: { id: A, title: 't' } })).toBe(true)
    expect(hasAnyRetrieval({ archetypes: [{ id: A, title: 't' }] })).toBe(true)
    expect(hasAnyRetrieval({ substrate: [{ id: A, title: 't' }] })).toBe(true)
  })
})

describe('parseRetrievalMeta', () => {
  it('returns null for null / undefined / non-object input', () => {
    expect(parseRetrievalMeta(null)).toBeNull()
    expect(parseRetrievalMeta(undefined)).toBeNull()
    expect(parseRetrievalMeta('garbage')).toBeNull()
    expect(parseRetrievalMeta(42)).toBeNull()
  })

  it('returns null when no bucket survives parsing', () => {
    expect(parseRetrievalMeta({})).toBeNull()
    expect(parseRetrievalMeta({ cortex: { id: 'x' } })).toBeNull()
    expect(parseRetrievalMeta({ archetypes: [{ junk: true }] })).toBeNull()
    expect(parseRetrievalMeta({ archetypes: 'not-an-array' })).toBeNull()
  })

  it('keeps cortex and drops archetypes when archetypes is non-array', () => {
    const out = parseRetrievalMeta({
      cortex: { id: A, title: 'cortex' },
      archetypes: 'not-an-array',
    })
    expect(out).toEqual({ cortex: { id: A, title: 'cortex' } })
  })

  it('filters non-snapshot entries inside an array', () => {
    const out = parseRetrievalMeta({
      archetypes: [
        { id: A, title: 'good' },
        'junk',
        { id: 5, title: 't' },
        null,
        { id: B, title: 'also good' },
      ],
    })
    expect(out?.archetypes).toEqual([
      { id: A, title: 'good' },
      { id: B, title: 'also good' },
    ])
  })

  it('parses a full payload across all three buckets', () => {
    const raw = {
      cortex: { id: A, title: 'cortex' },
      archetypes: [{ id: B, title: 'archetype' }],
      substrate: [{ id: A, title: 'sub' }],
    }
    const out = parseRetrievalMeta(raw)
    expect(out).toEqual<ChatRetrievalMeta>({
      cortex: { id: A, title: 'cortex' },
      archetypes: [{ id: B, title: 'archetype' }],
      substrate: [{ id: A, title: 'sub' }],
    })
  })

  it('does not return empty archetypes/substrate arrays in the output', () => {
    const out = parseRetrievalMeta({
      cortex: { id: A, title: 'c' },
      archetypes: [{ wrong: true }],
      substrate: [],
    })
    expect(out?.archetypes).toBeUndefined()
    expect(out?.substrate).toBeUndefined()
    expect(out?.cortex).toEqual({ id: A, title: 'c' })
  })

  it('rejects a cortex with missing fields but keeps valid neighbours', () => {
    const out = parseRetrievalMeta({
      cortex: { id: A },
      substrate: [{ id: B, title: 't' }],
    })
    expect(out?.cortex).toBeUndefined()
    expect(out?.substrate).toEqual([{ id: B, title: 't' }])
  })
})

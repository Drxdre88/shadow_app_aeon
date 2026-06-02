import { describe, it, expect } from 'vitest'
import { toPromptRetrieval, toRetrievalMeta } from '../chat-retrieval-mapping'
import type { ChatRetrieval } from '../chat-retrieval'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function makeRetrieval(): ChatRetrieval {
  const now = new Date()
  return {
    cortex: { id: A, title: 'cortex doc', body: 'cortex body', streamClass: 'cortex', createdAt: now },
    archetypes: [
      { id: B, title: 'archetype-1', body: 'arch body', streamClass: 'archetype', createdAt: now },
    ],
    substrate: [
      { id: C, title: 'sub-1', body: 'sub body', streamClass: 'reflection', createdAt: now },
    ],
  }
}

describe('toPromptRetrieval', () => {
  it('maps all three buckets and preserves substrate streamClass', () => {
    const out = toPromptRetrieval(makeRetrieval())
    expect(out.cortex).toEqual({ id: A, title: 'cortex doc', body: 'cortex body' })
    expect(out.archetypes).toEqual([{ id: B, title: 'archetype-1', body: 'arch body' }])
    expect(out.substrate).toEqual([{ id: C, title: 'sub-1', body: 'sub body', streamClass: 'reflection' }])
  })

  it('passes null cortex through unchanged', () => {
    const out = toPromptRetrieval({ cortex: null, archetypes: [], substrate: [] })
    expect(out.cortex).toBeNull()
    expect(out.archetypes).toEqual([])
    expect(out.substrate).toEqual([])
  })

  it('does not leak DB-only fields (createdAt, body on persisted snapshot)', () => {
    const out = toPromptRetrieval(makeRetrieval())
    // prompt cortex carries body but NOT createdAt — assert shape
    expect(out.cortex).not.toHaveProperty('createdAt')
    expect(out.archetypes[0]).not.toHaveProperty('createdAt')
  })
})

describe('toRetrievalMeta', () => {
  it('emits id+title only, omits bodies and createdAt', () => {
    const out = toRetrievalMeta(makeRetrieval())
    expect(out.cortex).toEqual({ id: A, title: 'cortex doc' })
    expect(out.archetypes).toEqual([{ id: B, title: 'archetype-1' }])
    expect(out.substrate).toEqual([{ id: C, title: 'sub-1' }])
  })

  it('returns an empty meta when retrieval is empty', () => {
    const out = toRetrievalMeta({ cortex: null, archetypes: [], substrate: [] })
    expect(out).toEqual({})
  })

  it('omits empty buckets so the persisted payload stays compact', () => {
    const out = toRetrievalMeta({
      cortex: null,
      archetypes: [{ id: B, title: 'a', body: '', streamClass: 'archetype', createdAt: new Date() }],
      substrate: [],
    })
    expect(out.cortex).toBeUndefined()
    expect(out.archetypes).toHaveLength(1)
    expect(out.substrate).toBeUndefined()
  })
})

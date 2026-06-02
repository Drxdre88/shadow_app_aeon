import { describe, it, expect } from 'vitest'
import {
  extractCitationIds,
  intersectWithRetrieved,
  type CitationRetrievalShape,
} from '../chat-retrieval-citations'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'

function emptyRetrieval(): CitationRetrievalShape {
  return { cortex: null, archetypes: [], substrate: [] }
}

function makeRetrieval(): CitationRetrievalShape {
  return {
    cortex: { id: A },
    archetypes: [{ id: B }],
    substrate: [{ id: C }],
  }
}

describe('extractCitationIds', () => {
  it('returns empty for plain text', () => {
    expect(extractCitationIds('hello world')).toEqual([])
  })

  it('parses a single inline citation', () => {
    const out = extractCitationIds(`see [[${A}]] for context`)
    expect(out).toEqual([A])
  })

  it('de-duplicates repeated ids', () => {
    const out = extractCitationIds(`[[${A}]] and again [[${A}]]`)
    expect(out).toEqual([A])
  })

  it('extracts multiple distinct ids preserving order of first appearance', () => {
    const out = extractCitationIds(`first [[${B}]] then [[${A}]] and again [[${B}]] plus [[${C}]]`)
    expect(out).toEqual([B, A, C])
  })

  it('ignores tokens that are not valid uuids', () => {
    expect(extractCitationIds('[[not-a-uuid]] [[1234]]')).toEqual([])
  })

  it('lower-cases uppercase uuid input', () => {
    const upper = A.toUpperCase()
    expect(extractCitationIds(`[[${upper}]]`)).toEqual([A])
  })
})

describe('intersectWithRetrieved', () => {
  it('keeps only ids that exist in the retrieval set', () => {
    const out = intersectWithRetrieved([A, B, C, D], makeRetrieval())
    expect(out.sort()).toEqual([A, B, C].sort())
  })

  it('drops hallucinated ids when retrieval is empty', () => {
    const out = intersectWithRetrieved([A, B], emptyRetrieval())
    expect(out).toEqual([])
  })

  it('returns empty when no ids cited', () => {
    expect(intersectWithRetrieved([], makeRetrieval())).toEqual([])
  })
})

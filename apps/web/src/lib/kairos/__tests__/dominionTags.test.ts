import { describe, it, expect } from 'vitest'
import { DOMINION_TAG_PREFIX, dominionTag, dominionIdsFromTags } from '../dominionTags'

const A = 'd0000000-0000-4000-8000-00000000000a'
const B = 'd0000000-0000-4000-8000-00000000000b'

describe('dominionTag', () => {
  it('encodes an id behind the dominion: prefix', () => {
    expect(dominionTag(A)).toBe(`${DOMINION_TAG_PREFIX}${A}`)
  })
})

describe('dominionIdsFromTags', () => {
  it('extracts only dominion-reference ids, ignoring other tags', () => {
    expect(dominionIdsFromTags(['kairos-dialogue', dominionTag(A), 'note', dominionTag(B)]))
      .toEqual([A, B])
  })

  it('round-trips with dominionTag', () => {
    expect(dominionIdsFromTags([A, B].map(dominionTag))).toEqual([A, B])
  })

  it('is defensive against non-array / non-string input', () => {
    expect(dominionIdsFromTags(null)).toEqual([])
    expect(dominionIdsFromTags(undefined)).toEqual([])
    expect(dominionIdsFromTags([1, 2, dominionTag(A)])).toEqual([A])
  })
})

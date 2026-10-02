import { describe, expect, it } from 'vitest'
import { fedIdListSchema, makeFedIdResolver } from '../introspection-prompt'

// Shared citation grounding (archetypes, cortex, concepts, beliefs, weekly review).
const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

describe('makeFedIdResolver', () => {
  const resolve = makeFedIdResolver([ID_A, ID_B])

  it('resolves exact ids case-insensitively to the canonical fed id', () => {
    expect(resolve(ID_A)).toBe(ID_A)
    expect(resolve(ID_A.toUpperCase())).toBe(ID_A)
    expect(resolve(`mem:${ID_B}`)).toBe(ID_B)
  })

  it('drops invented ids and non-strings', () => {
    expect(resolve('33333333-3333-4333-8333-333333333333')).toBeNull()
    expect(resolve(null)).toBeNull()
    expect(resolve(42)).toBeNull()
  })

  // Regression: 2026-07-24 Shadow Apps — models cite "[3b11ff33]"-style
  // shortened bracketed ids; a unique ≥8-char prefix must resolve.
  it('resolves a bracketed shortened id via a unique prefix', () => {
    expect(resolve('[11111111]')).toBe(ID_A)
  })

  it('drops an ambiguous prefix and a too-short one', () => {
    const twin = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(makeFedIdResolver([ID_A, twin])('11111111')).toBeNull()
    expect(resolve('[111]')).toBeNull()
  })
})

describe('fedIdListSchema', () => {
  it('accepts a bare string, filters non-strings and caps the list', () => {
    expect(fedIdListSchema(2).parse(ID_A)).toEqual([ID_A])
    expect(fedIdListSchema(2).parse([ID_A, null, 3, ID_B, 'x'])).toEqual([ID_A, ID_B])
    expect(fedIdListSchema(2).parse(undefined)).toEqual([])
  })
})
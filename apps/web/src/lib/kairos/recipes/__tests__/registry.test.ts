import { describe, it, expect } from 'vitest'
import { getRecipe, listRecipes } from '../registry'

describe('registry', () => {
  it('returns null for unknown recipe name', () => {
    expect(getRecipe('NOPE')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(getRecipe('')).toBeNull()
  })

  it('does not match Object.prototype keys (prototype-pollution guard)', () => {
    expect(getRecipe('toString')).toBeNull()
    expect(getRecipe('hasOwnProperty')).toBeNull()
    expect(getRecipe('__proto__')).toBeNull()
  })

  it('listRecipes returns descriptor-only entries (no flat/expanded leak)', () => {
    for (const descriptor of listRecipes()) {
      expect(Object.keys(descriptor).sort()).toEqual([
        'description',
        'name',
        'reads',
        'writes',
      ])
    }
  })

  it('listRecipes is empty until brief.ts lands', () => {
    expect(listRecipes()).toEqual([])
  })
})

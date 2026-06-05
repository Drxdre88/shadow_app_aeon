import { describe, it, expect, vi } from 'vitest'

// brief.ts → route-task.ts → db. Mock the db so importing the registry
// doesn't trip DATABASE_URL during unit-test bootstrap.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

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

  it('listRecipes includes BRIEF', () => {
    const names = listRecipes().map((d) => d.name)
    expect(names).toContain('BRIEF')
  })

  it('getRecipe("BRIEF") returns the live recipe', () => {
    const brief = getRecipe('BRIEF')
    expect(brief).not.toBeNull()
    expect(brief?.name).toBe('BRIEF')
    expect(typeof brief?.flat).toBe('function')
  })
})

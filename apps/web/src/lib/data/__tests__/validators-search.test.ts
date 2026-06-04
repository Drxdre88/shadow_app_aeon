import { describe, it, expect } from 'vitest'
import { searchMemoriesSchema } from '../validators'

const DOMINION_ID = 'b0000000-0000-4000-8000-000000000002'

describe('searchMemoriesSchema — Phase 3B query/dominionId refinement', () => {
  it('accepts a query alone', () => {
    const r = searchMemoriesSchema.safeParse({ query: 'auth migration' })
    expect(r.success).toBe(true)
  })

  it('accepts a dominionId alone (no query)', () => {
    const r = searchMemoriesSchema.safeParse({ dominionId: DOMINION_ID })
    expect(r.success).toBe(true)
  })

  it('accepts both query and dominionId', () => {
    const r = searchMemoriesSchema.safeParse({ query: 'auth', dominionId: DOMINION_ID })
    expect(r.success).toBe(true)
  })

  it('rejects when neither query nor dominionId is given', () => {
    const r = searchMemoriesSchema.safeParse({ limit: 10 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/query is required/i)
    }
  })

  it('accepts sinceDays in range', () => {
    const r = searchMemoriesSchema.safeParse({ dominionId: DOMINION_ID, sinceDays: 7 })
    expect(r.success).toBe(true)
  })

  it('rejects sinceDays out of range', () => {
    const r = searchMemoriesSchema.safeParse({ dominionId: DOMINION_ID, sinceDays: 0 })
    expect(r.success).toBe(false)
    const r2 = searchMemoriesSchema.safeParse({ dominionId: DOMINION_ID, sinceDays: 9999 })
    expect(r2.success).toBe(false)
  })

  it('still rejects empty query string', () => {
    const r = searchMemoriesSchema.safeParse({ query: '' })
    expect(r.success).toBe(false)
  })

  it('defaults limit and offset', () => {
    const r = searchMemoriesSchema.parse({ dominionId: DOMINION_ID })
    expect(r.limit).toBe(20)
    expect(r.offset).toBe(0)
  })
})

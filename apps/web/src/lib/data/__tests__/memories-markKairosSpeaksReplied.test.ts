import { beforeEach, describe, expect, it, vi } from 'vitest'

const drizzleMocks = vi.hoisted(() => ({
  and: vi.fn(),
  eq: vi.fn(),
  sql: vi.fn(),
}))
const returningRows: Array<{ id: string }> = []
const setCalls: Record<string, unknown>[] = []
const whereCalls: unknown[] = []

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  drizzleMocks.eq.mockImplementation((column, value) => ({ kind: 'eq', column, value }))
  drizzleMocks.and.mockImplementation((...conditions) => ({ kind: 'and', conditions }))
  drizzleMocks.sql.mockImplementation((strings, ...values) => ({
    kind: 'sql',
    strings: Array.from(strings as TemplateStringsArray),
    values,
  }))
  Object.assign(drizzleMocks.sql, actual.sql)
  return {
    ...actual,
    and: drizzleMocks.and,
    eq: drizzleMocks.eq,
    sql: drizzleMocks.sql,
  }
})

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.set = (patch: Record<string, unknown>) => {
        setCalls.push(patch)
        return chain
      }
      chain.where = (condition: unknown) => {
        whereCalls.push(condition)
        return chain
      }
      chain.returning = () => Promise.resolve([...returningRows])
      return chain
    }),
  },
}))

import { memories } from '@/lib/db/schema'
import { markKairosSpeaksReplied } from '../memories'

const USER = 'user-1'
const BEFORE = new Date('2026-07-19T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  returningRows.length = 0
  setCalls.length = 0
  whereCalls.length = 0
})

describe('markKairosSpeaksReplied', () => {
  it('stamps pending speaks as replied in one update', async () => {
    returningRows.push({ id: 'speak-1' }, { id: 'speak-2' })

    await expect(markKairosSpeaksReplied(USER, BEFORE)).resolves.toBe(2)

    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].updatedAt).toBeInstanceOf(Date)
    const metadataPatch = setCalls[0].sourceMetadata as { strings: string[]; values: unknown[] }
    expect(metadataPatch.strings.join(' ')).toContain('jsonb_build_object')
    expect(metadataPatch.strings.join(' ')).toContain("'status', 'replied'")
    expect(metadataPatch.values).toContainEqual(expect.stringMatching(/^2026-|^20\d\d-/))
  })

  it('is idempotent when no pending rows remain', async () => {
    await expect(markKairosSpeaksReplied(USER, BEFORE)).resolves.toBe(0)
    expect(setCalls).toHaveLength(1)
  })

  it('scopes the update to the requested user and pending Kairos speaks', async () => {
    await markKairosSpeaksReplied(USER, BEFORE)

    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.userId, USER)
    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.type, 'inbound')
    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.source, 'system')
    const predicates = drizzleMocks.sql.mock.calls.map(([strings]) => (
      Array.from(strings as TemplateStringsArray).join(' ')
    ))
    expect(predicates.some((text) => text.includes("->>'kairosSpeak' = 'true'"))).toBe(true)
    expect(predicates.some((text) => text.includes("->>'status' = 'pending'"))).toBe(true)
    expect(whereCalls).toHaveLength(1)
  })

  it('limits the update to speaks created on or before the supplied boundary', async () => {
    await markKairosSpeaksReplied(USER, BEFORE)

    const boundaryCall = drizzleMocks.sql.mock.calls.find(([strings]) => (
      Array.from(strings as TemplateStringsArray).join(' ').includes('<=')
    ))
    expect(boundaryCall?.slice(1)).toContain(BEFORE)
  })
})

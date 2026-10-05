import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

vi.mock('@/lib/data/kairos-sensitive', () => ({ getSensitiveGate: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))

import { getSensitiveGate } from '@/lib/data/kairos-sensitive'
import { sensitiveCaptureStamp } from '../capture'
import { heldSensitive, notHeldSensitive, notHeldSensitiveRaw } from '../held'
import { validAsOfNow } from '@/lib/data/memories'

const gate = vi.mocked(getSensitiveGate)
const render = (s: SQL) => new PgDialect().sqlToQuery(s)

beforeEach(() => {
  gate.mockReset()
})

describe('sensitiveCaptureStamp', () => {
  it('stamps and holds a matching row when the gate is on', async () => {
    gate.mockResolvedValue(true)
    const stamp = await sensitiveCaptureStamp('u1', { title: 'Note', bodyMd: 'My doctor changed the medication' }, 'reflection')
    expect(stamp).toEqual({ sensitive: true, sensitiveHeld: true, sensitiveTopics: ['health'] })
  })

  it('leaves rows alone when the gate is off (the default)', async () => {
    gate.mockResolvedValue(false)
    expect(await sensitiveCaptureStamp('u1', { title: 'Divorce', bodyMd: 'x' })).toEqual({})
  })

  it('does not read the preference when nothing matches', async () => {
    expect(await sensitiveCaptureStamp('u1', { title: 'Ship the board', bodyMd: 'tech debt' })).toEqual({})
    expect(gate).not.toHaveBeenCalled()
  })

  it('never holds bookkeeping streams', async () => {
    gate.mockResolvedValue(true)
    expect(await sensitiveCaptureStamp('u1', { title: 'hospital', bodyMd: 'hospital' }, 'trace')).toEqual({})
    expect(gate).not.toHaveBeenCalled()
  })

  it('captures normally when the preference read fails', async () => {
    gate.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await sensitiveCaptureStamp('u1', { title: 'hospital', bodyMd: 'x' })).toEqual({})
    warn.mockRestore()
  })
})

describe('retrieval exclusion', () => {
  it('holds rows flagged sensitiveHeld out of validAsOfNow without adding bound params', () => {
    const own = render(notHeldSensitive)
    expect(own.sql).toBe(`("memories"."source_metadata"->>'sensitiveHeld') IS DISTINCT FROM 'true'`)
    expect(own.params).toEqual([])
    const live = render(validAsOfNow)
    expect(live.sql).toContain('"invalid_at" IS NULL OR "memories"."invalid_at" > NOW()')
    expect(live.sql).toContain(`->>'sensitiveHeld') IS DISTINCT FROM 'true'`)
    expect(live.params).toEqual([])
  })

  it('spells the held check once: positive, negative and aliased raw forms', () => {
    expect(render(heldSensitive)).toEqual({ sql: `("memories"."source_metadata"->>'sensitiveHeld') = 'true'`, params: [] })
    expect(notHeldSensitiveRaw('m2')).toBe(`(m2.source_metadata->>'sensitiveHeld') IS DISTINCT FROM 'true'`)
    expect(() => notHeldSensitiveRaw('m; drop table memories')).toThrow(/alias/)
  })
})

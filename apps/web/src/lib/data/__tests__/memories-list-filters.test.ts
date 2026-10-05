import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// `= ANY(${array})` renders as `ANY(($1))` and Postgres rejects it
// ("malformed array literal"); that blanked the Kairos inbox and the weekly
// review's board pages in production. Type filters must render as IN lists.

const calls: Array<{ where?: SQL }> = []

vi.mock('@/lib/db', () => {
  function makeChain() {
    const rec: { where?: SQL } = {}
    calls.push(rec)
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: SQL) => { rec.where = w; return chain }
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.offset = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  return { db: { select: vi.fn(() => makeChain()) } }
})

import { listMemories } from '../memories'

const render = (s: unknown) => new PgDialect().sqlToQuery(s as SQL)

beforeEach(() => {
  calls.length = 0
})

describe('listMemories type filter', () => {
  it('renders a single type as an IN list, not ANY()', async () => {
    await listMemories('user-1', { type: 'inbound' })
    const { sql, params } = render(calls[0].where)
    expect(sql).toMatch(/"memories"\."type" in \(\$\d+\)/)
    expect(sql).not.toMatch(/ANY\(/i)
    expect(params).toContain('inbound')
  })

  it('renders several types as one IN list', async () => {
    await listMemories('user-1', { type: ['achievement', 'inbound'] })
    const { sql, params } = render(calls[0].where)
    expect(sql).toMatch(/"memories"\."type" in \(\$\d+, \$\d+\)/)
    expect(params).toEqual(expect.arrayContaining(['achievement', 'inbound']))
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('no interpolated arrays inside ANY()', () => {
  it('keeps `ANY(${...})` out of the source tree', () => {
    const root = join(__dirname, '..', '..', '..')
    const offenders = sourceFiles(root).filter((f) => /ANY\(\s*\$\{/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

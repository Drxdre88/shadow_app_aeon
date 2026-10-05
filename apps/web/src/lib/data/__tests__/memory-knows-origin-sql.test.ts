import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

// The SQL origin inference behind "Needs your eyes" must classify exactly like
// origin.ts inferOriginKind. The rendered CASE is parsed and evaluated here
// against the TS function for representative sources and activity kinds.

vi.mock('@/lib/db', () => ({ db: {} }))

import { sqlOriginKind } from '../memory-knows'
import { ACTIVITY_KINDS, AGENT_SOURCES, inferOriginKind } from '@/lib/kairos/origin'

const rendered = new PgDialect().sqlToQuery(sqlOriginKind)
const SOURCE = '"memories"."source"'
const META_KIND = `"memories"."source_metadata"->>'kind'`

type Rule = { lhs: string; values: string[]; kind: string }
const rules: Rule[] = [...rendered.sql.matchAll(/when\s+(\S+?)\s+in\s+\(([^)]*)\)\s+then\s+'(\w+)'/g)].map((m) => ({
  lhs: m[1],
  values: m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, '')),
  kind: m[3],
}))
const fallback = /else\s+'(\w+)'\s+end\)\s*$/.exec(rendered.sql)?.[1]

function sqlInfer(source: string | null, metaKind: string | null): string | undefined {
  for (const r of rules) {
    const value = r.lhs === SOURCE ? source : r.lhs === META_KIND ? metaKind : (() => { throw new Error(`unknown lhs ${r.lhs}`) })()
    if (value !== null && r.values.includes(value)) return r.kind
  }
  return fallback
}

const SOURCES = ['manual', 'voice', 'import', 'webhook', 'cron', 'system', ...AGENT_SOURCES, 'telegram', 'email', 'mystery', null]
const KINDS = [...ACTIVITY_KINDS, 'cortex', null]

describe('sqlOriginKind mirrors inferOriginKind', () => {
  it('renders without bound params and with the inferred arm parsed', () => {
    expect(rendered.params).toEqual([])
    expect(rules.length).toBeGreaterThanOrEqual(5)
    expect(fallback).toBe('external')
  })

  it.each(SOURCES.flatMap((source) => KINDS.map((kind) => [source, kind] as const)))('source %s, kind %s', (source, kind) => {
    expect(sqlInfer(source, kind)).toBe(inferOriginKind(source, kind ? { kind } : {}))
  })

  it('only trusts a stored origin label that is a known kind', () => {
    expect(rendered.sql).toContain(`->'origin'->>'kind' in ('operator', 'activity', 'agent', 'kairos', 'external')`)
  })
})

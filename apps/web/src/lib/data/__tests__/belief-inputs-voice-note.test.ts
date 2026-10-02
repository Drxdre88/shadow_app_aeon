import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Confirmed voice-note segments reach the belief extractor flagged, so the
// prompt quotes up to 2,000 chars of the operator's own dictation.

const state = vi.hoisted(() => ({ columns: null as Record<string, unknown> | null, rows: [] as unknown[] }))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = () => chain
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(state.rows).then(res)
  return { db: { select: (cols: Record<string, unknown>) => { state.columns = cols; return chain } } }
})
vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`true` }
})

import { listOperatorSignals } from '../belief-inputs'
import { buildExtractPrompt } from '@/lib/kairos/beliefs/extract-prompt'

const dialect = new PgDialect()

function row(id: string, bodyMd: string, sourceMetadata: Record<string, unknown>, voiceNote: boolean) {
  return {
    id, title: `t-${id}`, aiTitle: null, summary: 'short summary', bodyMd, type: 'reflection', kind: null,
    createdAt: new Date('2026-10-01T09:00:00Z'), source: 'manual', sourceMetadata, voiceNote,
  }
}

describe('belief signals — voice notes', () => {
  it('selects a voiceNote flag from sourceMetadata', async () => {
    state.rows = []
    await listOperatorSignals('user-1', null)
    const flag = dialect.sqlToQuery(state.columns!.voiceNote as SQL).sql
    expect(flag).toBe(`("memories"."source_metadata"->'voiceNote') IS NOT NULL`)
  })

  it('passes the flag through, so the extract prompt quotes up to 2,000 chars of a voice note', async () => {
    const long = 'I keep choosing depth over speed. '.repeat(80) // ~2,700 chars
    state.rows = [
      row('vn-1', long, { origin: { kind: 'operator', via: 'voice' }, voiceNote: { noteId: 'n', part: 1, of: 1 } }, true),
      row('r-1', long, { origin: { kind: 'operator', via: 'manual' } }, false),
    ]
    const inputs = await listOperatorSignals('user-1', null)
    expect(inputs.map((i) => [i.id, i.voiceNote, i.origin])).toEqual([['vn-1', true, 'operator'], ['r-1', false, 'operator']])

    const prompt = buildExtractPrompt({ dominions: [], held: [], inputs })
    const voiceLine = prompt.split('\n').find((l) => l.includes('[vn-1]'))!
    const plainLine = prompt.split('\n').find((l) => l.includes('[r-1]'))!
    expect(voiceLine.length).toBeGreaterThan(2_000)
    expect(plainLine).toContain('short summary')
    expect(plainLine.length).toBeLessThan(700)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core'

// Recording fake of the Drizzle client (pattern from concepts.test.ts): every
// builder call is logged and each awaited statement resolves the next queued
// result; a queued function is called with the statement's entry.
type Entry = { op: string; table?: string; where?: string; params?: unknown[]; values?: unknown; set?: unknown }
const state = vi.hoisted(() => ({ results: [] as unknown[], log: [] as Entry[] }))

vi.mock('@/lib/db', () => {
  const dialect = new PgDialect()
  function builder(entry: Entry) {
    state.log.push(entry)
    const b: Record<string, unknown> = {}
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === 'from') entry.table = getTableName(args[0] as PgTable)
      if (name === 'where' && args[0]) {
        const q = dialect.sqlToQuery(args[0] as SQL)
        entry.where = q.sql
        entry.params = q.params
      }
      if (name === 'values') entry.values = args[0]
      if (name === 'set') entry.set = args[0]
      return b
    }
    for (const m of ['from', 'where', 'orderBy', 'limit', 'values', 'set', 'returning']) b[m] = chain(m)
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const next = state.results.shift()
      return Promise.resolve(typeof next === 'function' ? next(entry) : next).then(res, rej)
    }
    return b
  }
  const db = {
    select: () => builder({ op: 'select' }),
    insert: (t: PgTable) => builder({ op: 'insert', table: getTableName(t) }),
    update: (t: PgTable) => builder({ op: 'update', table: getTableName(t) }),
    execute: async () => {
      state.log.push({ op: 'execute' })
      return { rows: [] }
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})

import { discardVoiceNote, stageVoiceNote, transcriptHash } from '../voice-notes'
import { acceptProposal } from '../memories'

type Row = { sourceMetadata: Record<string, unknown> } & Record<string, unknown>

const USER = '00000000-0000-4000-8000-000000000001'
const DOM = '00000000-0000-4000-8000-0000000000d1'
const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i} is what I actually said about the roadmap.`).join(' ')

const echoInsert = (entry: Entry) =>
  (entry.values as Row[]).map((v, i) => ({ id: `seg-${i + 1}`, type: v.type, archivedAt: null, sourceMetadata: v.sourceMetadata }))

beforeEach(() => {
  state.results = []
  state.log = []
})

describe('stageVoiceNote', () => {
  it('stages every segment as a pending agent-origin reflection proposal with a verbatim excerpt summary', async () => {
    state.results.push([], echoInsert)
    const res = await stageVoiceNote(USER, { transcript: long }, { source: 'claude', via: 'mcp' })
    if (!res.ok) throw new Error('expected ok')
    const insert = state.log.find((e) => e.op === 'insert')!
    const rows = insert.values as Row[]
    expect(rows.length).toBeGreaterThan(1)
    expect(res).toMatchObject({ created: true, parts: rows.length, proposalIds: rows.map((_, i) => `seg-${i + 1}`), summaryId: null })
    rows.forEach((r, i) => {
      expect(r).toMatchObject({ type: 'inbound', streamClass: 'agentic', source: 'claude', dominionId: null, tags: ['proposal', 'voice_note'] })
      expect(r.sourceMetadata).toEqual({
        introspection: true,
        kind: 'reflection',
        status: 'pending',
        voiceNote: { noteId: res.noteId, part: i + 1, of: rows.length, hash: transcriptHash(long) },
        origin: { kind: 'agent', via: 'mcp' },
      })
      expect(long).toContain(r.bodyMd as string)
      expect((r.bodyMd as string).startsWith(r.summary as string)).toBe(true)
      expect(r.title).toBe(`Voice note ${i + 1}/${rows.length}: ${r.summary}`)
    })
    expect(state.log[0].op).toBe('execute')
  })

  it('returns the existing note for the same transcript within 10 minutes and writes nothing', async () => {
    const meta = (part: number) => ({ introspection: true, kind: 'reflection', status: 'pending', voiceNote: { noteId: 'N1', part, of: 2, hash: 'h' } })
    state.results.push([
      { id: 'b', type: 'inbound', archivedAt: null, sourceMetadata: meta(2) },
      { id: 'a', type: 'inbound', archivedAt: null, sourceMetadata: meta(1) },
    ])
    const res = await stageVoiceNote(USER, { transcript: long }, { source: 'claude', via: 'mcp' })
    expect(res).toEqual({ ok: true, noteId: 'N1', parts: 2, created: false, proposalIds: ['a', 'b'], summaryId: null })
    expect(state.log.some((e) => e.op === 'insert')).toBe(false)
    const lookup = state.log.find((e) => e.op === 'select')!
    expect(lookup.where).toContain(`->'voiceNote'->>'hash' =`)
    expect(lookup.params).toContain(transcriptHash(long))
    expect(lookup.where).toContain('"archived_at" is null')
  })

  it('stores Claude\'s summary as a separate agent note linked to the segments, never a proposal', async () => {
    state.results.push([{ id: DOM }], [], echoInsert, [{ id: 'sum-1' }])
    const res = await stageVoiceNote(USER, { transcript: 'One short thought.', dominionId: DOM, claudeSummary: 'Owner wants X.' }, { source: 'manual', via: 'rest-session' })
    expect(res).toMatchObject({ ok: true, parts: 1, proposalIds: ['seg-1'], summaryId: 'sum-1' })
    const [, summary] = state.log.filter((e) => e.op === 'insert').map((e) => e.values as Row)
    expect(summary).toMatchObject({ type: 'note', bodyMd: 'Owner wants X.', dominionId: DOM, links: [{ type: 'refers_to', target: 'seg-1', target_kind: 'memory' }] })
    expect(summary.sourceMetadata).not.toHaveProperty('introspection')
    expect(summary.sourceMetadata).not.toHaveProperty('voiceNote')
    expect(summary.sourceMetadata.origin).toEqual({ kind: 'agent', via: 'rest-session' })
  })

  it('refuses a Dominion the user does not own', async () => {
    state.results.push([])
    expect(await stageVoiceNote(USER, { transcript: 'x.', dominionId: DOM }, { source: 'claude', via: 'mcp' }))
      .toEqual({ ok: false, reason: 'dominion_not_found' })
  })
})

describe('confirm path (acceptProposal on a staged segment)', () => {
  it('turns an agent-origin segment into the operator\'s reflection', async () => {
    state.results.push([], echoInsert)
    const res = await stageVoiceNote(USER, { transcript: 'I want fewer meetings.' }, { source: 'claude', via: 'mcp' })
    if (!res.ok) throw new Error('expected ok')
    const staged = { ...(state.log.find((e) => e.op === 'insert')!.values as Row[])[0], id: 'seg-1', links: [] }
    state.log = []
    state.results.push([staged], (entry: Entry) => [{ ...staged, ...(entry.set as object) }])
    const accepted = await acceptProposal('seg-1', USER, { pin: false })
    if (!accepted?.ok) throw new Error('expected accept')
    expect(accepted.memory).toMatchObject({ type: 'reflection', streamClass: 'reflection' })
    expect(accepted.memory.sourceMetadata).toMatchObject({
      status: 'accepted',
      origin: { kind: 'operator', via: 'accept' },
      priorOrigin: { kind: 'agent', via: 'mcp' },
      voiceNote: { noteId: res.noteId, part: 1, of: 1 },
    })
  })
})

describe('discardVoiceNote', () => {
  const seg = (id: string, part: number, type = 'inbound', status = 'pending') => ({
    id, type, archivedAt: null, sourceMetadata: { introspection: true, kind: 'reflection', status, voiceNote: { noteId: 'N', part, of: 2 } },
  })

  it('archives the pending segments and the summary note', async () => {
    state.results.push([seg('a', 1), seg('b', 2)], [], [], [])
    expect(await discardVoiceNote(USER, 'N')).toEqual({ noteId: 'N', parts: 2, discarded: 2 })
    const updates = state.log.filter((e) => e.op === 'update')
    expect(updates).toHaveLength(3)
    expect(updates[0].set).toMatchObject({ archivedAt: expect.any(Date) })
    expect(updates[2].where).toContain(`->'voiceNoteSummary'->>'noteId' =`)
  })

  it('leaves accepted segments and the summary alone', async () => {
    state.results.push([seg('a', 1, 'reflection', 'accepted'), seg('b', 2)], [])
    expect(await discardVoiceNote(USER, 'N')).toEqual({ noteId: 'N', parts: 2, discarded: 1 })
    expect(state.log.filter((e) => e.op === 'update')).toHaveLength(1)
  })

  it('returns null for an unknown note', async () => {
    state.results.push([])
    expect(await discardVoiceNote(USER, 'missing')).toBeNull()
  })
})

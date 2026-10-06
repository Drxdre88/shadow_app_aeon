import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Pins the on-read repo handover: label ↔ slug resolution, open-card scoping
// (labels, not archived, not in Done/Vault, owner or member boards), the
// top-N caps, and the deterministic "Start here" paragraph.

const h = vi.hoisted(() => ({ selectResults: [] as unknown[][], wheres: [] as unknown[], limits: [] as number[] }))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'groupBy']) chain[k] = () => chain
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.limit = (n: number) => { h.limits.push(n); return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.selectResults.shift() ?? [])
    return chain
  }
  return { db: { select: vi.fn(select) } }
})
vi.mock('@/lib/data/ask', () => ({ listOpenKairosAsks: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ listKairosPromises: vi.fn() }))
vi.mock('@/lib/data/repo-memory', () => ({ listRepoSessions: vi.fn(), findRepoPlaybook: vi.fn() }))

import { listOpenKairosAsks } from '@/lib/data/ask'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { findRepoPlaybook, listRepoSessions } from '@/lib/data/repo-memory'
import { readRepoHandover } from '../repo-handover'
import { renderRepoHandoverMarkdown } from '@/lib/kairos/repo-memory/render'

const dialect = new PgDialect()
const render = (q: unknown) => dialect.sqlToQuery(q as SQL)
const NOW = new Date('2026-10-06T20:00:00.000Z')

const card = (id: string, column: string | null, priority = 'medium') => ({ id, name: `Card ${id}`, priority, boardId: 'b1', board: 'AI Mission Control', column })

beforeEach(() => {
  vi.clearAllMocks()
  h.selectResults = []
  h.wheres = []
  h.limits = []
  vi.mocked(listRepoSessions).mockResolvedValue([
    { id: 's1', repo: 'shadow_app_aeon', title: 'Auth fix', summary: 'Fixed the magic-link redirect loop. Then tidied tests.', body: '', client: 'claude', createdAt: new Date('2026-10-06T10:00:00.000Z') },
    { id: 's2', repo: 'shadow_app_aeon', title: 'Hangar run', summary: null, body: '**Status:** done — shipped\nmore', client: 'codex', createdAt: new Date('2026-10-05T10:00:00.000Z') },
  ])
  vi.mocked(listOpenKairosAsks).mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({
    id: `a${i}`, seq: i + 1, title: `Question ${i + 1}?`, summary: null, dominionId: null, createdAt: NOW,
    kairosAsk: { status: 'pending', askedAt: NOW.toISOString(), aetherMemoryId: 'x', sourceThoughtId: null, sourceMemoryIds: [], dominionId: null },
  })) as never)
  vi.mocked(listKairosPromises).mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, seq: i + 1, outcome: `Outcome ${i + 1}`, dueDate: '2026-10-20' })) as never)
  vi.mocked(findRepoPlaybook).mockResolvedValue({
    id: 'pb1', slug: 'shadow_app_aeon', updatedAt: NOW,
    playbook: { v: 1, repo: 'shadow_app_aeon', day: '2026-10-06', citations: ['s1'], sessionCount: 1, jobId: 'j', answeredBy: 'routine', lessons: [{ kind: 'trap', text: 'Never call the DB from components.', sourceIds: ['s1'] }] },
  })
})

describe('readRepoHandover', () => {
  it('resolves a board label to its folder slug and every label pointing at it', async () => {
    h.selectResults = [[card('t1', 'Depot', 'high'), card('t1', 'Depot', 'high'), card('t2', 'Live')], [{ taskId: 't2', total: 4, done: 1 }]]
    const out = await readRepoHandover('u1', { repo: 'repo:kairos' }, NOW)
    expect(out?.repo).toEqual({ slug: 'shadow_app_aeon', labels: ['aeon', 'kairos'] })
    expect(listRepoSessions).toHaveBeenCalledWith('u1', 'shadow_app_aeon', 3)
    expect(findRepoPlaybook).toHaveBeenCalledWith('u1', 'shadow_app_aeon')
    expect(listKairosPromises).toHaveBeenCalledWith('u1', { scope: 'open' })

    const q = render(h.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['repo:aeon', 'repo:kairos', 'done', 'vault', 'u1']))
    expect(q.sql).toContain('"board_tasks"."archived_at" is null')
    expect(q.sql).toMatch(/exists \(select 1 from "project_members"/)
    expect(h.limits[0]).toBe(30)

    expect(out?.cards).toEqual([
      { ...card('t1', 'Depot', 'high'), checklist: { done: 0, total: 0 } },
      { ...card('t2', 'Live'), checklist: { done: 1, total: 4 } },
    ])
  })

  it('accepts the folder slug too, caps asks and promises at five, and summarises sessions in one line', async () => {
    h.selectResults = [[]]
    const out = await readRepoHandover('u1', { repo: 'shadow_app_aeon' }, NOW)
    expect(out?.asks).toHaveLength(5)
    expect(out?.asks[0]).toEqual({ label: 'Q1', question: 'Question 1?', askedAt: NOW.toISOString() })
    expect(out?.promises.map((p) => p.number)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
    expect(out?.sessions.map((s) => s.summary)).toEqual(['Fixed the magic-link redirect loop.', 'Status: done — shipped'])
    expect(out?.playbook).toMatchObject({ id: 'pb1', day: '2026-10-06', lessons: [{ kind: 'trap' }] })
    expect(out?.assembledAt).toBe(NOW.toISOString())
  })

  it('Start here points at the in-flight card, else the top card, deterministically', async () => {
    h.selectResults = [[card('t1', 'Depot', 'high'), card('t2', 'Live')], [{ taskId: 't2', total: 4, done: 1 }]]
    const out = await readRepoHandover('u1', { repo: 'aeon' }, NOW)
    expect(out?.startHere).toBe(
      'The last agent session here was on 2026-10-06 (claude): Fixed the magic-link redirect loop. 2 open cards carry its label. ' +
      'The playbook holds 1 lesson (updated 2026-10-06). Next obvious step: carry on with "Card t2" (Live on AI Mission Control, checklist 1/4).',
    )
    h.selectResults = [[card('t1', 'Depot', 'high')], []]
    const again = await readRepoHandover('u1', { repo: 'aeon' }, NOW)
    expect(again?.startHere).toContain('Next obvious step: start "Card t1" (high priority, Depot on AI Mission Control).')
  })

  it('an unknown repo resolves to itself; a junk name is not a repo', async () => {
    h.selectResults = [[]]
    vi.mocked(listRepoSessions).mockResolvedValue([])
    vi.mocked(findRepoPlaybook).mockResolvedValue(null)
    const out = await readRepoHandover('u1', { repo: 'new_thing' }, NOW)
    expect(out?.repo).toEqual({ slug: 'new_thing', labels: ['new_thing'] })
    expect(out?.startHere).toMatch(/^No agent session has been recorded for this repo yet\. No open cards carry its label\./)
    expect(await readRepoHandover('u1', { repo: 'dev_26' }, NOW)).toBeNull()
  })

  it('renders markdown with the assembled time and every section', async () => {
    h.selectResults = [[card('t2', 'Live')], [{ taskId: 't2', total: 2, done: 2 }]]
    const md = renderRepoHandoverMarkdown((await readRepoHandover('u1', { repo: 'aeon' }, NOW))!)
    expect(md).toContain('# Handover · shadow_app_aeon')
    expect(md).toContain(`_Assembled on read ${NOW.toISOString()} · board labels repo:aeon, repo:kairos._`)
    for (const s of ['## Start here', '## Recent sessions', '## Open cards', '## Lessons (updated 2026-10-06)', '## Open questions from Vorath', '## Open promises']) {
      expect(md).toContain(s)
    }
    expect(md).toContain('- **Card t2** — Live on AI Mission Control · medium, checklist 2/2')
    expect(md).toContain('- **Trap:** Never call the DB from components. _(from s1)_')
  })
})

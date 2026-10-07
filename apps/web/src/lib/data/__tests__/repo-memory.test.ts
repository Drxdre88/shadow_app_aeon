import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Pins the repo-memory data layer with a recording drizzle stand-in: user
// scoping, the held-sensitive filter, both repo spellings, exact slug match,
// and the one-row-per-repo playbook upsert inside a transaction.

const h = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  wheres: [] as unknown[],
  limits: [] as number[],
  executes: [] as unknown[],
  updates: [] as Array<{ set: Record<string, unknown>; inTx: boolean }>,
  inserts: [] as Array<{ values: Record<string, unknown>; inTx: boolean }>,
  inTx: false,
}))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['from', 'orderBy']) chain[k] = () => chain
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.limit = (n: number) => { h.limits.push(n); return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.selectResults.shift() ?? [])
    return chain
  }
  const client = {
    select: vi.fn(select),
    execute: vi.fn(async (q: unknown) => { h.executes.push(q) }),
    update: vi.fn(() => ({ set: (set: Record<string, unknown>) => ({ where: async () => { h.updates.push({ set, inTx: h.inTx }) } }) })),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => { h.inserts.push({ values, inTx: h.inTx }); return [{ id: 'new-pb' }] },
      }),
    })),
  }
  return {
    db: {
      ...client,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        h.inTx = true
        try { return await fn(client) } finally { h.inTx = false }
      }),
    },
  }
})

import { SENSITIVE_HELD_KEY } from '@/lib/kairos/sensitive/meta'
import { listRepoGitDigestsBetween, listRepoPlaybooks, listRepoSessions, listSessionSummariesBetween, upsertRepoPlaybook } from '../repo-memory'

const dialect = new PgDialect()
const render = (q: unknown) => dialect.sqlToQuery(q as SQL)
const AT = new Date('2026-10-06T01:00:00.000Z')

const row = (id: string, rawRepo: string | null) => ({ id, title: `T ${id}`, summary: null, body: 'body', rawRepo, client: 'claude', createdAt: AT })

const playbook = (jobId: string) => ({
  v: 1 as const, repo: 'shadow_app_aeon', day: '2026-10-06', citations: ['s1'], sessionCount: 1, jobId, answeredBy: 'routine',
  lessons: [{ kind: 'worked' as const, text: 'Small files.', sourceIds: ['s1'] }],
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { selectResults: [], wheres: [], limits: [], executes: [], updates: [], inserts: [], inTx: false })
})

describe('session summaries by repo', () => {
  it('reads one user’s unheld session summaries in the window, keyed by either repo spelling', async () => {
    h.selectResults = [[row('a', 'shadow_app_aeon'), row('b', 'sefe/Short Term Power/stp_app_ermac'), row('c', null), row('d', 'dev_26')]]
    const rows = await listSessionSummariesBetween('u1', new Date('2026-10-05T01:00:00.000Z'), AT)
    expect(rows.map((r) => [r.id, r.repo])).toEqual([['a', 'shadow_app_aeon'], ['b', 'stp_app_ermac']])
    const q = render(h.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'session_summary']))
    expect(q.sql).toContain(`->>'${SENSITIVE_HELD_KEY}') IS DISTINCT FROM 'true'`)
    expect(q.sql).toMatch(/"created_at" >= \$\d+/)
    expect(q.sql).toMatch(/"created_at" < \$\d+/)
  })

  it('carries session facts: the stored record wins, hook commits/files fill its gaps', async () => {
    h.selectResults = [[
      { ...row('a', 'shadow_app_aeon'), record: { commits: [{ sha: 's', subject: 'feat: x' }], tests: { status: 'passed' } }, hookCommits: [{ sha: 'h', subject: 'hook' }], hookFiles: ['src/a.ts'] },
      { ...row('b', 'shadow_app_aeon'), record: null, hookCommits: null, hookFiles: null },
    ]]
    const [a, b] = await listSessionSummariesBetween('u1', new Date('2026-10-05T01:00:00.000Z'), AT)
    expect(a.facts).toMatchObject({ commits: ['feat: x'], tests: { status: 'passed' }, files: ['a.ts'] })
    expect(b.facts).toBeNull()
  })

  it('keeps only rows whose normalised repo is exactly the slug', async () => {
    h.selectResults = [[row('a', 'C:/dev/shadow_app_aeon'), row('b', 'shadow_app_aeon_old'), row('c', 'shadow_app_aeon'), row('d', 'shadow_app_aeon')]]
    const rows = await listRepoSessions('u1', 'shadow_app_aeon', 2)
    expect(rows.map((r) => r.id)).toEqual(['a', 'c'])
    const q = render(h.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'session_summary', '%shadow_app_aeon%']))
    expect(q.sql).toMatch(/coalesce\(nullif\("memories"\."source_metadata"->>'repo', ''\), "memories"\."source_metadata"->'session'->>'repo'\)/)
  })
})

describe('repo git digests', () => {
  const meta = (repoSlug: unknown, o: Record<string, unknown> = {}) => ({
    kind: 'repo_git_digest', externalId: `git-digest:${repoSlug}:2026-10-05`, repoSlug, day: '2026-10-05',
    stats: { commits: 12, linesAdded: 400, prsMerged: 2 },
    commits: Array.from({ length: 15 }, (_, i) => ({ sha: `sha${i}`, subject: `feat: change ${i}`, aiAssisted: i % 2 === 0 })),
    ...o,
  })

  it('reads one user’s unheld, unarchived digest observations in the window by kind', async () => {
    h.selectResults = [[
      { id: 'g1', summary: '12 commits, +400/−0 lines (code +0), 2 PRs merged', sourceMetadata: meta('C:/dev_26/shadow_app_aeon') },
      { id: 'g2', summary: null, sourceMetadata: meta('dev_26') },
      { id: 'g3', summary: null, sourceMetadata: { kind: 'repo_git_digest' } },
    ]]
    const rows = await listRepoGitDigestsBetween('u1', new Date('2026-10-05T01:00:00.000Z'), AT)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'g1', slug: 'shadow_app_aeon', day: '2026-10-05', summary: '12 commits, +400/−0 lines (code +0), 2 PRs merged', stats: { commits: 12, linesAdded: 400, codeAdded: 0, prsMerged: 2 } })
    expect(rows[0].commits).toHaveLength(8)
    expect(rows[0].commits[0]).toEqual({ sha: 'sha0', subject: 'feat: change 0', aiAssisted: true })
    const q = render(h.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'observation', 'repo_git_digest']))
    expect(q.sql).toMatch(/"memories"\."user_id" = \$\d+/)
    expect(q.sql).toContain(`"memories"."source_metadata"->>'kind' = $`)
    expect(q.sql).toContain('"memories"."archived_at" is null')
    expect(q.sql).toContain(`->>'${SENSITIVE_HELD_KEY}') IS DISTINCT FROM 'true'`)
    expect(q.sql).toMatch(/"created_at" >= \$\d+/)
    expect(q.sql).toMatch(/"created_at" < \$\d+/)
  })
})

describe('repo playbooks', () => {
  it('reads playbooks by external key and parses their lessons', async () => {
    h.selectResults = [[{ id: 'pb1', sourceMetadata: { kind: 'repo_playbook', repoSlug: 'shadow_app_aeon', playbook: playbook('j1') }, updatedAt: AT }]]
    const [pb] = await listRepoPlaybooks('u1', ['shadow_app_aeon'])
    expect(pb).toMatchObject({ id: 'pb1', slug: 'shadow_app_aeon', playbook: { lessons: [{ text: 'Small files.' }] } })
    expect(render(h.wheres[0]).params).toEqual(expect.arrayContaining(['u1', 'repo_playbook', 'repo_playbook:shadow_app_aeon']))
    expect(await listRepoPlaybooks('u1', [])).toEqual([])
  })

  const values = (jobId: string) => ({ title: 'Lessons · shadow_app_aeon', bodyMd: '# body', summary: '1 lesson', playbook: playbook(jobId) })

  it('inserts the first playbook as an internal trace row, inside a locked transaction', async () => {
    h.selectResults = [[]]
    expect(await upsertRepoPlaybook('u1', values('j1'))).toEqual({ memoryId: 'new-pb', written: true })
    expect(h.executes).toHaveLength(1)
    const [{ values: v, inTx }] = h.inserts
    expect(inTx).toBe(true)
    expect(v).toMatchObject({ userId: 'u1', type: 'observation', streamClass: 'trace', source: 'cron', dominionId: null })
    expect(v.sourceMetadata).toEqual({ kind: 'repo_playbook', externalKey: 'repo_playbook:shadow_app_aeon', repoSlug: 'shadow_app_aeon', playbook: playbook('j1') })
    expect(v.sourceMetadata).not.toHaveProperty('repo')
  })

  it('updates the same row on a later night', async () => {
    h.selectResults = [[{ id: 'pb1', sourceMetadata: { playbook: playbook('j-old') } }]]
    expect(await upsertRepoPlaybook('u1', values('j2'))).toEqual({ memoryId: 'pb1', written: true })
    expect(h.inserts).toHaveLength(0)
    expect(h.updates[0]).toMatchObject({ inTx: true, set: { title: 'Lessons · shadow_app_aeon', embedding: null, sourceMetadata: { playbook: { jobId: 'j2' } } } })
  })

  it('leaves the row alone when the same job applies twice', async () => {
    h.selectResults = [[{ id: 'pb1', sourceMetadata: { playbook: playbook('j2') } }]]
    expect(await upsertRepoPlaybook('u1', values('j2'))).toEqual({ memoryId: 'pb1', written: false })
    expect(h.updates).toHaveLength(0)
    expect(h.inserts).toHaveLength(0)
  })
})

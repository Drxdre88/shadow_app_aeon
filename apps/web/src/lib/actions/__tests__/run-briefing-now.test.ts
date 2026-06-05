import { describe, it, expect, vi, beforeEach } from 'vitest'

// Kairos Phase 3C — runBriefingNow rewire coverage.
// The dashboard "Regenerate today" button targets this. force=true issues a
// destructive UPDATE archiving today's matching advisory rows before
// dispatching the BRIEF recipe; this test pins that the WHERE clause is
// scoped per-dominion (so we never archive the wrong row) and verifies the
// per-error skip ladder maps the dispatcher's known throws to the legacy
// reason strings the UI surfaces.

vi.mock('next-auth', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

const updateCalls: Array<{ values?: unknown; whereRaw?: unknown }> = []

vi.mock('@/lib/db', () => {
  function makeUpdateChain() {
    const call: { values?: unknown; whereRaw?: unknown } = {}
    updateCalls.push(call)
    const chain: Record<string, unknown> = {}
    chain.set = (v: unknown) => { call.values = v; return chain }
    chain.where = (w: unknown) => { call.whereRaw = w; return chain }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return chain
  }
  return {
    db: {
      update: vi.fn(() => makeUpdateChain()),
      select: vi.fn(),
      insert: vi.fn(),
    },
  }
})

vi.mock('@/lib/db/schema', () => {
  // The action imports `boardTasks` and `groupMembers`; transitively pulled
  // modules touch `projects`, `memories`, etc. Stub each as a Proxy that
  // returns a unique sentinel per column access — enough for drizzle column
  // references to type-check at runtime without modelling the real schema.
  const tableProxy = (name: string) =>
    new Proxy({}, { get: (_t, prop) => `${name}.${String(prop)}` })
  const tables = [
    'boardTasks', 'groupMembers', 'projects', 'memories', 'projectMembers',
    'users', 'workspaceGroups', 'dominions', 'dominionRepos',
    'boardColumns', 'labels', 'taskDependencies', 'checklistItems',
    'ganttViews', 'rows', 'ganttTasks', 'canvasNodes', 'canvasEdges',
    'taskVault', 'activityEvents', 'apiKeys', 'boardSnapshots', 'realmInvites',
    'userAiCredentials', 'sessions', 'sessionEvents', 'enginePolicies',
  ]
  return Object.fromEntries(tables.map((t) => [t, tableProxy(t)]))
})

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    ({ kind: 'sql', strings, values }),
  isNull: (col: unknown) => ({ kind: 'isNull', col }),
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ kind: 'eq', a, b }),
}))

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
}))

vi.mock('@/lib/kairos/dispatch', () => ({
  runRecipe: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {
    constructor(public providerId?: string) {
      super('missing')
      this.name = 'AiCredentialMissingError'
    }
  },
}))

vi.mock('../helpers', () => ({
  requireAuth: vi.fn(async () => 'user-1'),
}))

import { runBriefingNow } from '../memories'
import { findDominionsByUser } from '@/lib/data/dominions'
import { runRecipe } from '@/lib/kairos/dispatch'
import { AiCredentialMissingError } from '@/lib/ai/router'

const DOM_A = { id: 'dom-a', name: 'Alpha', archivedAt: null }
const DOM_B = { id: 'dom-b', name: 'Beta', archivedAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  updateCalls.length = 0
  ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A, DOM_B])
})

describe('runBriefingNow', () => {
  it('force=false: never archives, dispatches per active Dominion, tallies created/existing', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm1', traceId: 't1' })
      .mockResolvedValueOnce({ status: 'existing', memoryId: 'm2', traceId: null })

    const result = await runBriefingNow({ force: false })

    expect(updateCalls).toHaveLength(0)
    expect(runRecipe).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ran: 2, created: 1, existing: 1, skipped: [] })
  })

  it('force=true: archives once per dominion before dispatching, with externalId scoped to that dom', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm1', traceId: 't1' })
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm2', traceId: 't2' })

    await runBriefingNow({ force: true })

    expect(updateCalls).toHaveLength(2)
    // Walk the captured WHERE structure for each archive call; the
    // externalId equality must reference the dominion's own id.
    const externalIdsArchived: string[] = []
    for (const call of updateCalls) {
      const where = call.whereRaw as { kind: string; args: unknown[] }
      // and(...) contains an eq(memories.userId, ...), eq(memories.type, ...), sql`...`, isNull(...)
      const sqlNode = where.args.find((a) => (a as { kind?: string }).kind === 'sql') as
        | { values: unknown[] }
        | undefined
      expect(sqlNode).toBeTruthy()
      // sql`${memories.sourceMetadata}->>'externalId' = ${`briefer:${date}:${dom.id}`}`
      // → values[0] is the column ref, values[1] is the externalId string.
      const externalId = sqlNode!.values.find(
        (v): v is string => typeof v === 'string' && v.startsWith('briefer:'),
      )
      expect(externalId).toBeTruthy()
      externalIdsArchived.push(externalId!)
    }
    expect(externalIdsArchived[0]).toContain(`:${DOM_A.id}`)
    expect(externalIdsArchived[1]).toContain(`:${DOM_B.id}`)
  })

  it('maps AiCredentialMissingError to skipped reason "no BYOK credential"', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AiCredentialMissingError('openai'))
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm2', traceId: 't2' })

    const result = await runBriefingNow({})
    expect(result.skipped).toEqual([{ dominionName: 'Alpha', reason: 'no BYOK credential' }])
    expect(result.created).toBe(1)
  })

  it('maps "BRIEF: no Dominion bundle" to skipped reason "not found"', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('BRIEF: no Dominion bundle for dom-a'))
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm2', traceId: 't2' })

    const result = await runBriefingNow({})
    expect(result.skipped).toEqual([{ dominionName: 'Alpha', reason: 'not found' }])
  })

  it('maps "BRIEF: empty response" to skipped reason "empty response"', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('BRIEF: empty response from provider'))
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm2', traceId: 't2' })

    const result = await runBriefingNow({})
    expect(result.skipped).toEqual([{ dominionName: 'Alpha', reason: 'empty response' }])
  })

  it('unknown errors propagate (abort the batch, do not silently swallow)', async () => {
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('db connection lost'))

    await expect(runBriefingNow({})).rejects.toThrow('db connection lost')
  })

  it('skips archived dominions even when force=true', async () => {
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      DOM_A,
      { ...DOM_B, archivedAt: new Date() },
    ])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm1', traceId: 't1' })

    const result = await runBriefingNow({ force: true })
    expect(result.ran).toBe(1)
    expect(runRecipe).toHaveBeenCalledTimes(1)
    expect(updateCalls).toHaveLength(1)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// claimNextSession hands a runner someone's prompt to execute, so its predicate
// is a security boundary, not a filter: user-scoped, card-linked only (chat and
// dialogue rows live in the same table), queued only, engine-narrowed.
// recordSessionResult is the other end — it must never re-apply a result to a
// session that already settled.

type Capture = { where?: unknown; set?: unknown; forArgs?: unknown[] }

const selectQueue: unknown[][] = []
const updateQueue: unknown[][] = []
const captures: Capture[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function chain(rows: () => unknown[], capture: Capture) {
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.from = pass
    c.values = pass
    c.orderBy = pass
    c.limit = pass
    c.set = (arg: unknown) => { capture.set = arg; return c }
    c.where = (arg: unknown) => { capture.where = arg; return c }
    c.for = (...args: unknown[]) => { capture.forArgs = args; return c }
    c.returning = () => Promise.resolve(rows())
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return c
  }

  function makeDb() {
    return {
      select: vi.fn(() => {
        const capture: Capture = {}
        captures.push(capture)
        return chain(() => selectQueue.shift() ?? [], capture)
      }),
      update: vi.fn(() => {
        const capture: Capture = {}
        captures.push(capture)
        return chain(() => updateQueue.shift() ?? [], capture)
      }),
    }
  }

  return {
    db: {
      ...makeDb(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalls++
        return fn(makeDb())
      }),
    },
  }
})

vi.mock('../columns', () => ({ findColumns: vi.fn(async () => []) }))
vi.mock('../projects', () => ({ findProjectSettings: vi.fn(async () => null) }))
vi.mock('../tasks', () => ({ updateTask: vi.fn(async () => ({ id: 'task', columnId: null })) }))

import { claimNextSession, recordSessionResult } from '../sessions'
import { sessionEventsTailSchema } from '../validators'
import { updateTask } from '../tasks'
import { findProjectSettings } from '../projects'
import { findColumns } from '../columns'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER = '10000000-0000-4000-8000-0000000000ff'
const SESSION_ID = '20000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000001'
const PROJECT_ID = '40000000-0000-4000-8000-000000000001'
const WORKER = 'runner-01'

const dialect = new PgDialect()
const compile = (value: unknown) => dialect.sqlToQuery(value as SQL)

const ENVELOPE = {
  status: 'completed' as const,
  outcome: 'implemented',
  summary: 'Mission done.',
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateQueue.length = 0
  captures.length = 0
  transactionCalls = 0
})

describe('claimNextSession', () => {
  it('claims a queued, card-linked session for the calling user only', async () => {
    selectQueue.push([{ id: SESSION_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'running', claimedBy: WORKER }])

    const row = await claimNextSession(USER_ID, WORKER)

    expect(row).toMatchObject({ id: SESSION_ID, status: 'running', claimedBy: WORKER })
    expect(transactionCalls).toBe(1)

    const where = compile(captures[0].where)
    expect(where.sql).toContain('"agent_sessions"."user_id" = $1')
    expect(where.sql).toContain('"agent_sessions"."status" = $2')
    expect(where.sql).toContain('"agent_sessions"."task_id" is not null')
    expect(where.params[0]).toBe(USER_ID)
    expect(where.params[1]).toBe('queued')
    expect(where.params).not.toContain(OTHER_USER)
  })

  it('locks the candidate row with SKIP LOCKED so runners can poll concurrently', async () => {
    selectQueue.push([{ id: SESSION_ID }])
    updateQueue.push([{ id: SESSION_ID }])

    await claimNextSession(USER_ID, WORKER)

    expect(captures[0].forArgs).toEqual(['update', { skipLocked: true }])
  })

  it('narrows the claim to the engines the runner asked for', async () => {
    selectQueue.push([{ id: SESSION_ID }])
    updateQueue.push([{ id: SESSION_ID }])

    await claimNextSession(USER_ID, WORKER, ['codex'])

    const where = compile(captures[0].where)
    expect(where.sql).toContain('"agent_sessions"."engine" in ($3)')
    expect(where.params[2]).toBe('codex')
    expect(where.params).not.toContain('claude')
  })

  it('defaults to every claimable engine', async () => {
    selectQueue.push([{ id: SESSION_ID }])
    updateQueue.push([{ id: SESSION_ID }])

    await claimNextSession(USER_ID, WORKER)

    const where = compile(captures[0].where)
    expect(where.params.slice(2)).toEqual(['claude', 'codex', 'copilot'])
  })

  it('stamps the claim on the row it flips to running', async () => {
    selectQueue.push([{ id: SESSION_ID }])
    updateQueue.push([{ id: SESSION_ID }])

    await claimNextSession(USER_ID, WORKER)

    expect(captures[1].set).toMatchObject({ status: 'running', claimedBy: WORKER })
  })

  it('returns null on an empty queue without touching any row', async () => {
    selectQueue.push([])

    await expect(claimNextSession(USER_ID, WORKER)).resolves.toBeNull()
    expect(captures).toHaveLength(1)
  })
})

describe('recordSessionResult', () => {
  it('returns null when the session does not exist', async () => {
    selectQueue.push([])

    await expect(recordSessionResult(SESSION_ID, ENVELOPE)).resolves.toBeNull()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it.each(['succeeded', 'failed', 'killed', 'timeout'])(
    'refuses to re-apply a result to a %s session',
    async (status) => {
      const session = { id: SESSION_ID, status, taskId: TASK_ID }
      selectQueue.push([session])
      // The guarded UPDATE matches nothing once the session has settled.
      updateQueue.push([])

      const result = await recordSessionResult(SESSION_ID, ENVELOPE)

      expect(result).toEqual({ session, task: null })
      expect(updateTask).not.toHaveBeenCalled()
    }
  )

  it('carries the terminal-status guard in the UPDATE, not in a prior read', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: null }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])

    await recordSessionResult(SESSION_ID, ENVELOPE)

    const update = compile(captures[1].where)
    expect(update.sql).toContain('"agent_sessions"."id" = $1')
    expect(update.sql).toContain('"agent_sessions"."status" not in ($2, $3, $4, $5)')
    expect(update.params).toEqual([SESSION_ID, 'succeeded', 'failed', 'killed', 'timeout'])
  })

  it('processes the card exactly once when two result posts race', async () => {
    const running = { id: SESSION_ID, status: 'running', taskId: TASK_ID }
    const card = { id: TASK_ID, projectId: PROJECT_ID, metadata: {} }

    // Winner: the guarded UPDATE matches, so it settles the session and the card.
    selectQueue.push([running])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    selectQueue.push([card])
    await recordSessionResult(SESSION_ID, ENVELOPE)
    expect(updateTask).toHaveBeenCalledTimes(1)

    // Loser: it read the same pre-race row, but its UPDATE now matches nothing.
    selectQueue.push([running])
    updateQueue.push([])
    const second = await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(second).toEqual({ session: running, task: null })
    expect(updateTask).toHaveBeenCalledTimes(1)
  })

  it('settles a chat-style session with no card and stops there', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: null }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])

    const result = await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(result).toMatchObject({ session: { status: 'succeeded' }, task: null })
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('settles the session but skips the card write when the card is gone', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: TASK_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    selectQueue.push([])

    const result = await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(result).toMatchObject({ session: { status: 'succeeded' }, task: null })
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('caches the envelope on the card and appends the session id', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: TASK_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    selectQueue.push([{
      id: TASK_ID,
      projectId: PROJECT_ID,
      metadata: { hangar: { repo: 'aeon', sessionIds: ['older-session'] } },
    }])

    await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(updateTask).toHaveBeenCalledWith(TASK_ID, PROJECT_ID, {
      metadata: {
        hangar: {
          repo: 'aeon',
          lastResult: ENVELOPE,
          sessionIds: ['older-session', SESSION_ID],
        },
      },
    })
  })

  it('does not move the card when the project is not a Hangar board', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: TASK_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    selectQueue.push([{ id: TASK_ID, projectId: PROJECT_ID, metadata: {} }])
    vi.mocked(findProjectSettings).mockResolvedValueOnce({ boardMode: 'board' } as never)

    await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(findColumns).not.toHaveBeenCalled()
    expect(vi.mocked(updateTask).mock.calls[0][2]).not.toHaveProperty('columnId')
  })

  it('moves a completed mission into the Hangar landing column', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: TASK_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'succeeded' }])
    selectQueue.push([{ id: TASK_ID, projectId: PROJECT_ID, metadata: {} }])
    vi.mocked(findProjectSettings).mockResolvedValueOnce({ boardMode: 'hangar' } as never)
    vi.mocked(findColumns).mockResolvedValueOnce([{ id: 'col-landing', name: 'Landing' }] as never)

    await recordSessionResult(SESSION_ID, ENVELOPE)

    expect(vi.mocked(updateTask).mock.calls[0][2]).toMatchObject({ columnId: 'col-landing' })
  })

  it('leaves a failed mission where it was launched', async () => {
    selectQueue.push([{ id: SESSION_ID, status: 'running', taskId: TASK_ID }])
    updateQueue.push([{ id: SESSION_ID, status: 'failed' }])
    selectQueue.push([{ id: TASK_ID, projectId: PROJECT_ID, metadata: {} }])
    vi.mocked(findProjectSettings).mockResolvedValueOnce({ boardMode: 'hangar' } as never)

    await recordSessionResult(SESSION_ID, { ...ENVELOPE, status: 'failed', outcome: 'blocked' })

    expect(findColumns).not.toHaveBeenCalled()
    expect(vi.mocked(updateTask).mock.calls[0][2]).not.toHaveProperty('columnId')
  })
})

describe('sessionEventsTailSchema', () => {
  it('coerces the query strings a URL actually carries', () => {
    expect(sessionEventsTailSchema.parse({ afterSeq: '12', limit: '50' })).toEqual({ afterSeq: 12, limit: 50 })
  })

  it('defaults limit and leaves afterSeq absent when the tail params are omitted', () => {
    expect(sessionEventsTailSchema.parse({})).toEqual({ limit: 500 })
  })

  it('rejects garbage instead of passing NaN to the driver', () => {
    expect(sessionEventsTailSchema.safeParse({ limit: 'abc' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: 'abc' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ limit: '10.5' }).success).toBe(false)
  })

  it('bounds limit to 1..500 and afterSeq to >= -1', () => {
    expect(sessionEventsTailSchema.safeParse({ limit: '500' }).success).toBe(true)
    expect(sessionEventsTailSchema.safeParse({ limit: '501' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: '-1' }).success).toBe(true)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: '-2' }).success).toBe(false)
  })
})

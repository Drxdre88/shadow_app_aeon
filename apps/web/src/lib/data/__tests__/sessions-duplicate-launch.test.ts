import { describe, it, expect, beforeEach, vi } from 'vitest'

// The partial unique index agent_sessions_one_live_per_task_idx is the ONE
// launch guard that holds across tabs, devices and surfaces. Production
// acceptance (11 September, check 10) fired four concurrent launches at one
// card: exactly one session was created — the money was safe — but the three
// losers came back as opaque 500s because the violation was recognised only
// when the driver happened to put the index name in `err.message`. These are
// the shapes a Postgres driver can hand back for that one violation.

let insertError: unknown = null

vi.mock('@/lib/db', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    c.values = () => c
    c.returning = () => (insertError ? Promise.reject(insertError) : Promise.resolve([{ id: 'session-1' }]))
    return c
  }
  return { db: { insert: vi.fn(() => chain()) } }
})

vi.mock('../columns', () => ({ findColumns: vi.fn(async () => []) }))
vi.mock('../projects', () => ({
  findProjectSettings: vi.fn(async () => null),
  touchProject: vi.fn(async () => {}),
}))

import { createAgentSession, LiveMissionExistsError } from '../sessions'

const IDX = 'agent_sessions_one_live_per_task_idx'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000001'

const INPUT = {
  engine: 'copilot' as const,
  goal: 'Duplicate launch probe',
  prompt: 'Do not execute.',
  taskId: TASK_ID,
}

function pgError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error(String(fields.message ?? 'error')), fields)
}

beforeEach(() => {
  insertError = null
})

describe('createAgentSession duplicate-launch mapping', () => {
  it('returns the row when the insert wins the race', async () => {
    await expect(createAgentSession(USER_ID, INPUT)).resolves.toEqual({ id: 'session-1' })
  })

  it('maps a unique violation that names the index in its message', async () => {
    insertError = pgError({
      code: '23505',
      message: `duplicate key value violates unique constraint "${IDX}"`,
    })
    await expect(createAgentSession(USER_ID, INPUT)).rejects.toBeInstanceOf(LiveMissionExistsError)
  })

  it('maps a unique violation that only carries the index as a constraint field', async () => {
    insertError = pgError({
      code: '23505',
      constraint: IDX,
      message: 'duplicate key value violates unique constraint',
    })
    await expect(createAgentSession(USER_ID, INPUT)).rejects.toBeInstanceOf(LiveMissionExistsError)
  })

  it('maps a violation the driver nested under cause', async () => {
    insertError = pgError({
      message: 'Failed query: insert into "agent_sessions"',
      cause: pgError({ code: '23505', constraint: IDX, message: 'duplicate key value' }),
    })
    await expect(createAgentSession(USER_ID, INPUT)).rejects.toBeInstanceOf(LiveMissionExistsError)
  })

  it('tells the caller which guard fired', async () => {
    insertError = pgError({ code: '23505', constraint: IDX, message: 'duplicate key value' })
    await expect(createAgentSession(USER_ID, INPUT))
      .rejects.toThrow(/already has a live mission/i)
  })

  it('never disguises an unrelated failure as a duplicate launch', async () => {
    insertError = pgError({ code: '23503', message: 'insert violates foreign key constraint' })
    await expect(createAgentSession(USER_ID, INPUT)).rejects.not.toBeInstanceOf(LiveMissionExistsError)

    insertError = pgError({ code: '23505', constraint: 'agent_sessions_pkey', message: 'duplicate key value' })
    await expect(createAgentSession(USER_ID, INPUT)).rejects.not.toBeInstanceOf(LiveMissionExistsError)
  })
})

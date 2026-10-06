import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// Mission check data layer: the owner-scoped switch, the candidate filter,
// and the guarded verdict write that only ever touches metadata.hangar.check.

const state = vi.hoisted(() => ({
  set: null as Record<string, unknown> | null,
  where: null as unknown,
  selectWhere: null as unknown,
  limit: null as number | null,
  returning: [] as unknown[],
  boardRows: [] as unknown[],
  inTx: false,
}))

vi.mock('@/lib/db', () => {
  const update = () => ({
    set: (arg: Record<string, unknown>) => {
      state.set = arg
      return { where: (w: unknown) => { state.where = w; return { returning: async () => state.returning } } }
    },
  })
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (w: unknown) => { state.selectWhere = w; return chain },
    orderBy: () => chain,
    limit: async (n: number) => { state.limit = n; return state.boardRows },
  }
  const select = () => chain
  const tx = { update, select }
  return {
    db: {
      update,
      select,
      transaction: async (cb: (t: typeof tx) => unknown) => {
        state.inTx = true
        try { return await cb(tx) } finally { state.inTx = false }
      },
    },
  }
})
vi.mock('../hangar-access', () => ({ canEditProject: vi.fn() }))

import { canEditProject } from '../hangar-access'
import { listMissionCheckCandidates, setProjectMissionCheck, writeMissionCheck } from '../mission-check'
import type { MissionCheck } from '@/lib/kairos/mission-check/types'

const dialect = new PgDialect()
const PROJECT = '40000000-0000-4000-8000-000000000001'
const OWNER = '50000000-0000-4000-8000-000000000002'
const query = (s: unknown) => dialect.sqlToQuery(s as SQL)

const CHECK: MissionCheck = {
  sessionId: 's-1', verdict: 'looks_done', reasons: ['ok'], unmet: [], note: 'Fine.', checkedAt: '2026-10-06T20:00:00.000Z', mode: 'on',
}

beforeEach(() => {
  vi.clearAllMocks()
  state.set = null
  state.where = null
  state.selectWhere = null
  state.limit = null
  state.returning = [{ id: PROJECT }]
  state.boardRows = [{ settings: { kairosMissionCheck: true } }]
  vi.mocked(canEditProject).mockResolvedValue(true)
})

describe('setProjectMissionCheck', () => {
  it('merges kairosMissionCheck: true and scopes the update to the board creator', async () => {
    await setProjectMissionCheck(PROJECT, OWNER, true)
    const s = query(state.set?.settings)
    expect(s.sql).toContain('coalesce("projects"."settings", \'{}\'::jsonb) ||')
    expect(s.params).toEqual([JSON.stringify({ kairosMissionCheck: true })])
    const w = query(state.where)
    expect(w.sql).toContain('"projects"."user_id" = $')
    expect(w.params).toEqual([PROJECT, OWNER])
  })

  it('removes only the key when switched off, and returns null for a non-creator', async () => {
    await setProjectMissionCheck(PROJECT, OWNER, false)
    expect(query(state.set?.settings).params).toEqual(['kairosMissionCheck'])
    state.returning = []
    expect(await setProjectMissionCheck(PROJECT, OWNER, true)).toBeNull()
  })
})

describe('listMissionCheckCandidates', () => {
  it('filters to finished, completed, non-plan, latest, unchecked missions on switched-on boards', async () => {
    await listMissionCheckCandidates(OWNER, new Date('2026-10-04T20:00:00Z'), 5)
    expect(state.limit).toBe(5)
    const w = query(state.selectWhere)
    expect(w.params).toContain(OWNER)
    expect(w.params).toContain('succeeded')
    expect(w.params).toContain('kairosMissionCheck')
    expect(w.sql).toContain(`) = 'true'::jsonb`)
    expect(w.sql).toContain(`-> 'hangar' ->> 'phase', '') <> 'plan'`)
    expect(w.sql).toContain(`-> 'lastResult' ->> 'status') = 'completed'`)
    expect(w.sql).toContain(`-> 'sessionIds' ->> -1) = "agent_sessions"."id"::text`)
    expect(w.sql).toContain(`-> 'check' ->> 'sessionId') is distinct from "agent_sessions"."id"::text`)
    expect(w.sql).toContain('"board_tasks"."archived_at" is null')
  })
})

describe('writeMissionCheck', () => {
  const input = { projectId: PROJECT, taskId: 't-1', userId: OWNER, check: CHECK }

  it('writes only metadata.hangar.check, guarded on the card still showing this session', async () => {
    expect(await writeMissionCheck(input)).toBe('written')
    expect(canEditProject).toHaveBeenCalledWith(PROJECT, OWNER)
    expect(Object.keys(state.set ?? {})).toEqual(['metadata'])
    const s = query(state.set?.metadata)
    expect(s.sql).toContain(`'{hangar,check}'`)
    expect(s.params).toEqual([JSON.stringify(CHECK)])
    const w = query(state.where)
    expect(w.sql).toContain(`-> 'sessionIds' ->> -1) = $`)
    expect(w.params).toEqual(['t-1', PROJECT, 's-1'])
  })

  it('refuses when the switch is off, the owner lost edit access, or the card moved on', async () => {
    state.boardRows = [{ settings: {} }]
    expect(await writeMissionCheck(input)).toBe('switched_off')
    state.boardRows = [{ settings: { kairosMissionCheck: true } }]
    vi.mocked(canEditProject).mockResolvedValue(false)
    expect(await writeMissionCheck(input)).toBe('denied')
    expect(state.set).toBeNull()
    vi.mocked(canEditProject).mockResolvedValue(true)
    state.returning = []
    expect(await writeMissionCheck(input)).toBe('stale')
  })
})

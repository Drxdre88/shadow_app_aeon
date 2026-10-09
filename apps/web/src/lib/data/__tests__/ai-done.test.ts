import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// AI DONE data layer: the creator-scoped switch, the board list, and the one
// writer that files ticked-but-not-done cards into an AI DONE column.

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  wheres: [] as unknown[],
  inserts: [] as Array<{ table: unknown; values: unknown; inTx: boolean }>,
  insertReturning: [] as unknown[][],
  updates: [] as Array<{ table: unknown; set: Record<string, unknown>; where: unknown; inTx: boolean }>,
  updateReturning: [] as unknown[],
  inTx: false,
}))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['from', 'innerJoin', 'orderBy', 'limit']) chain[k] = () => chain
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res, rej)
    return chain
  }
  const insert = (table: unknown) => ({
    values: (values: unknown) => {
      h.inserts.push({ table, values, inTx: h.inTx })
      return {
        returning: async () => h.insertReturning.shift() ?? [],
        onConflictDoNothing: async () => undefined,
        then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
      }
    },
  })
  const update = (table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: unknown) => {
        h.updates.push({ table, set, where, inTx: h.inTx })
        return {
          returning: async () => h.updateReturning,
          then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
        }
      },
    }),
  })
  const client = { select, insert, update }
  return {
    db: {
      ...client,
      transaction: async (fn: (t: typeof client) => unknown) => {
        h.inTx = true
        try { return await fn(client) } finally { h.inTx = false }
      },
    },
  }
})
vi.mock('../hangar-access', () => ({ canEditProject: vi.fn() }))
vi.mock('../projects', () => ({ touchProject: vi.fn() }))
vi.mock('../activity', () => ({ emitActivity: vi.fn(async () => undefined) }))

import { boardColumns, boardTasks, checklistItems, taskLabels } from '@/lib/db/schema'
import { canEditProject } from '../hangar-access'
import { touchProject } from '../projects'
import { emitActivity } from '../activity'
import { listAiDoneBoards, setProjectAiDone, writeAiDoneCards } from '../ai-done'
import type { AiDoneCard } from '@/lib/kairos/ai-done/types'

const dialect = new PgDialect()
const query = (s: unknown) => dialect.sqlToQuery(s as SQL)
const PROJECT = '40000000-0000-4000-8000-000000000001'
const OWNER = '50000000-0000-4000-8000-000000000002'

const CARD: AiDoneCard = {
  title: 'Triad Polish',
  description: 'Session tiles and light mode',
  repo: 'shadow_app_triad',
  labelIds: ['l-repo', 'l-foreign'],
  groups: [{ name: 'Checklist', items: ['Session tiles', 'Light mode'] }, { name: 'Popups', items: ['Notification popups'] }],
  sessionIds: ['m-1', 'm-2'],
}

const input = (cards: AiDoneCard[] = [CARD]) => ({ projectId: PROJECT, userId: OWNER, jobId: 'job-1', day: '2026-10-08', cards })

beforeEach(() => {
  vi.clearAllMocks()
  h.selects = []
  h.wheres = []
  h.inserts = []
  h.insertReturning = []
  h.updates = []
  h.updateReturning = [{ id: PROJECT }]
  vi.mocked(canEditProject).mockResolvedValue(true)
})

describe('setProjectAiDone', () => {
  it('merges kairosAiDone: true and scopes the update to the board creator', async () => {
    await setProjectAiDone(PROJECT, OWNER, true)
    const s = query(h.updates[0]?.set.settings)
    expect(s.sql).toContain('coalesce("projects"."settings", \'{}\'::jsonb) ||')
    expect(s.params).toEqual([JSON.stringify({ kairosAiDone: true })])
    const w = query(h.updates[0]?.where)
    expect(w.sql).toContain('"projects"."user_id" = $')
    expect(w.params).toEqual([PROJECT, OWNER])
  })

  it('removes only the key when switched off, and returns null for a non-creator', async () => {
    await setProjectAiDone(PROJECT, OWNER, false)
    expect(query(h.updates[0]?.set.settings).params).toEqual(['kairosAiDone'])
    h.updateReturning = []
    expect(await setProjectAiDone(PROJECT, OWNER, true)).toBeNull()
  })
})

describe('listAiDoneBoards', () => {
  it('lists only unarchived boards this user created with the switch on (boolean true)', async () => {
    await listAiDoneBoards(OWNER)
    const w = query(h.wheres[0])
    expect(w.params).toEqual(expect.arrayContaining([OWNER, 'kairosAiDone']))
    expect(w.sql).toContain(`) = 'true'::jsonb`)
    expect(w.sql).toContain(`->> 'archived') is distinct from 'true'`)
  })
})

describe('writeAiDoneCards', () => {
  const happyPath = (columns: unknown[]) => {
    h.selects = [
      [{ settings: { kairosAiDone: true } }],
      [],
      columns,
      [{ id: 'l-repo' }],
      [{ max: -1 }],
    ]
  }

  it('creates AI DONE just after Done, shifting later columns right, and files a ticked-but-not-done card', async () => {
    happyPath([{ id: 'c-todo', name: 'Todo', orderIndex: 0 }, { id: 'c-done', name: ' Done ', orderIndex: 1 }])
    h.insertReturning = [[{ id: 'c-ai' }], [{ id: 't-1', name: 'Triad Polish' }]]
    const out = await writeAiDoneCards(input())
    expect(out).toEqual({ status: 'written', created: [{ id: 't-1', name: 'Triad Polish' }] })

    const shift = h.updates.find((u) => u.table === boardColumns)
    expect(shift?.inTx).toBe(true)
    expect(query(shift?.set.orderIndex).sql).toContain('"board_columns"."order_index" + 1')
    expect(query(shift?.where).sql).toContain('"board_columns"."order_index" >')
    expect(query(shift?.where).params).toEqual([PROJECT, 1])

    const column = h.inserts.find((i) => i.table === boardColumns)
    expect(column?.values).toMatchObject({ projectId: PROJECT, name: 'AI DONE', orderIndex: 2 })

    const task = h.inserts.find((i) => i.table === boardTasks)
    expect(task?.inTx).toBe(true)
    expect(task?.values).toMatchObject({
      projectId: PROJECT,
      columnId: 'c-ai',
      name: 'Triad Polish',
      description: 'Session tiles and light mode',
      status: 'todo',
      priority: 'medium',
      completedAt: null,
      orderIndex: 0,
      metadata: { aiDone: { v: 1, jobId: 'job-1', day: '2026-10-08', repo: 'shadow_app_triad', sessionIds: ['m-1', 'm-2'] } },
    })
    expect(task?.values).not.toHaveProperty('endDate')

    expect(h.inserts.find((i) => i.table === taskLabels)?.values).toEqual([{ taskId: 't-1', labelId: 'l-repo' }])
    expect(h.inserts.find((i) => i.table === checklistItems)?.values).toEqual([
      { taskId: 't-1', title: 'Session tiles', groupName: 'Checklist', state: 'checked', completed: true, orderIndex: 0 },
      { taskId: 't-1', title: 'Light mode', groupName: 'Checklist', state: 'checked', completed: true, orderIndex: 1 },
      { taskId: 't-1', title: 'Notification popups', groupName: 'Popups', state: 'checked', completed: true, orderIndex: 2 },
    ])

    expect(touchProject).toHaveBeenCalledWith(PROJECT, { type: 'task:created' })
    expect(emitActivity).toHaveBeenCalledWith(PROJECT, 'task', 't-1', 'created', 'Triad Polish', { via: 'thinking:ai_done', jobId: 'job-1' }, OWNER, 'agent')
  })

  it('reuses an existing AI DONE column (any case) and appends after its cards', async () => {
    happyPath([{ id: 'c-ai', name: ' ai done', orderIndex: 3 }, { id: 'c-done', name: 'Done', orderIndex: 4 }])
    h.selects[4] = [{ max: 6 }]
    h.insertReturning = [[{ id: 't-1', name: 'Triad Polish' }]]
    await writeAiDoneCards(input())
    expect(h.inserts.some((i) => i.table === boardColumns)).toBe(false)
    expect(h.updates).toEqual([])
    expect(h.inserts.find((i) => i.table === boardTasks)?.values).toMatchObject({ columnId: 'c-ai', orderIndex: 7 })
  })

  it('appends the column at the end when the board has no Done column', async () => {
    happyPath([{ id: 'c-a', name: 'Todo', orderIndex: 0 }, { id: 'c-b', name: 'Review', orderIndex: 5 }])
    h.insertReturning = [[{ id: 'c-ai' }], [{ id: 't-1', name: 'Triad Polish' }]]
    await writeAiDoneCards(input())
    expect(h.updates).toEqual([])
    expect(h.inserts.find((i) => i.table === boardColumns)?.values).toMatchObject({ orderIndex: 6 })
  })

  it('skips a title this job already filed (idempotent re-apply) and writes nothing', async () => {
    h.selects = [[{ settings: { kairosAiDone: true } }], [{ name: 'triad  polish' }]]
    expect(await writeAiDoneCards(input())).toEqual({ status: 'written', created: [] })
    const filedWhere = query(h.wheres[1])
    expect(filedWhere.sql).toContain(`-> 'aiDone' ->> 'jobId' = $`)
    expect(filedWhere.params).toContain('job-1')
    expect(h.inserts).toEqual([])
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('refuses when the switch is off or the owner lost edit access', async () => {
    h.selects = [[{ settings: { kairosAiDone: 'true' } }]]
    expect(await writeAiDoneCards(input())).toEqual({ status: 'switched_off' })
    h.selects = [[{ settings: { kairosAiDone: true } }]]
    vi.mocked(canEditProject).mockResolvedValue(false)
    expect(await writeAiDoneCards(input())).toEqual({ status: 'denied' })
    expect(canEditProject).toHaveBeenCalledWith(PROJECT, OWNER)
    expect(h.inserts).toEqual([])
    expect(touchProject).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Goal → card tree data layer: requestCardTree checks edit access and queues
// one on-demand job; createCardTree writes the claim, every card, label,
// checklist item and dependency in ONE transaction, into the first column.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserts: [] as { table: unknown; values: unknown }[],
  transactions: 0,
  canEditProject: vi.fn(),
  findProjectBasic: vi.fn(),
  touchProject: vi.fn(async () => undefined),
  upsertJob: vi.fn(),
  claimCardTreeInTx: vi.fn(),
  stampCreatedTasksInTx: vi.fn(async () => undefined),
}))

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) c[m] = () => c
  c.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
  return c
}
function executor() {
  return {
    select: () => chain(h.selects.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        h.inserts.push({ table, values })
        const done = chain(undefined)
        return Object.assign(done, { onConflictDoNothing: () => chain(undefined) })
      },
    }),
  }
}

vi.mock('@/lib/db', () => ({
  db: {
    ...executor(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions++
      return fn(executor())
    },
  },
}))
vi.mock('../hangar-access', () => ({ canEditProject: h.canEditProject }))
vi.mock('../projects', () => ({ findProjectBasic: h.findProjectBasic, touchProject: h.touchProject }))
vi.mock('../thinking-jobs', () => ({ upsertJob: h.upsertJob }))
vi.mock('../card-tree-proposals', () => ({ claimCardTreeInTx: h.claimCardTreeInTx, stampCreatedTasksInTx: h.stampCreatedTasksInTx }))

import { boardTasks, checklistItems, taskDependencies, taskLabels } from '@/lib/db/schema'
import { cardTreeJobKey, createCardTree, requestCardTree } from '../card-tree'
import type { CardTree } from '@/lib/kairos/card-tree/types'

const OWNER = 'owner-1'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const TREE: CardTree = {
  projectId: PROJECT,
  projectName: 'Beta',
  goal: 'Ship sign-up',
  rationale: 'Because.',
  cards: [
    { key: 'A', name: 'Form', description: 'Build it', priority: 'high', labels: ['Frontend', 'Gone'], checklist: ['Sketch', 'Build'], dependsOn: [] },
    { key: 'B', name: 'API', description: '', priority: 'medium', labels: [], checklist: [], dependsOn: ['A'] },
  ],
}
const insertsInto = (table: unknown) => h.inserts.filter((i) => i.table === table).map((i) => i.values as Row[])

beforeEach(() => {
  vi.clearAllMocks()
  h.selects = []
  h.inserts = []
  h.transactions = 0
  h.canEditProject.mockResolvedValue(true)
  h.claimCardTreeInTx.mockResolvedValue(true)
  delete process.env.KAIROS_CARD_TREE
  delete process.env.KAIROS_LEVEL
})

describe('createCardTree', () => {
  it('writes the cards, labels, checklist and dependencies in one transaction, in the first column', async () => {
    h.selects = [[{ id: 'col-first' }], [{ id: 'lab-1', name: 'frontend' }], [{ max: 4 }]]
    const res = await createCardTree(OWNER, 'prop-1', TREE, new Date('2026-10-06T12:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(h.transactions).toBe(1)
    expect(h.canEditProject).toHaveBeenCalledWith(PROJECT, OWNER)
    expect(h.claimCardTreeInTx).toHaveBeenCalledWith(expect.anything(), OWNER, 'prop-1', expect.any(Date))

    const [tasks] = insertsInto(boardTasks)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => [t.name, t.columnId, t.orderIndex, t.priority])).toEqual([['Form', 'col-first', 5, 'high'], ['API', 'col-first', 6, 'medium']])
    const [idA, idB] = tasks.map((t) => t.id as string)
    expect(res.taskIds).toEqual([idA, idB])
    expect(insertsInto(taskLabels)).toEqual([[{ taskId: idA, labelId: 'lab-1' }]])
    expect(insertsInto(checklistItems)).toEqual([[{ taskId: idA, title: 'Sketch', orderIndex: 0 }, { taskId: idA, title: 'Build', orderIndex: 1 }]])
    expect(insertsInto(taskDependencies)).toEqual([[{ blockerTaskId: idA, blockedTaskId: idB }]])
    expect(h.stampCreatedTasksInTx).toHaveBeenCalledWith(expect.anything(), OWNER, 'prop-1', [idA, idB])
    expect(h.touchProject).toHaveBeenCalledOnce()
  })

  it('refuses an owner who can no longer edit the board, before any write', async () => {
    h.canEditProject.mockResolvedValue(false)
    expect(await createCardTree(OWNER, 'prop-1', TREE)).toEqual({ ok: false, reason: 'forbidden' })
    expect(h.transactions).toBe(0)
    expect(h.inserts).toEqual([])
  })

  it('writes nothing when the proposal was already claimed', async () => {
    h.claimCardTreeInTx.mockResolvedValue(false)
    expect(await createCardTree(OWNER, 'prop-1', TREE)).toEqual({ ok: false, reason: 'already_decided' })
    expect(h.inserts).toEqual([])
    expect(h.touchProject).not.toHaveBeenCalled()
  })
})

describe('requestCardTree', () => {
  it('is refused while the switch is off', async () => {
    expect(await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Ship it' })).toMatchObject({ ok: false, reason: 'off' })
    expect(h.upsertJob).not.toHaveBeenCalled()
  })

  it('is refused without edit access', async () => {
    process.env.KAIROS_CARD_TREE = '1'
    h.canEditProject.mockResolvedValue(false)
    expect(await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Ship it' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(h.upsertJob).not.toHaveBeenCalled()
  })

  it('queues one on-demand job keyed by board and goal, with the board in its context', async () => {
    process.env.KAIROS_CARD_TREE = '1'
    h.findProjectBasic.mockResolvedValue({ id: PROJECT, name: 'Beta' })
    h.selects = [[{ name: 'To do' }, { name: 'Done' }], [{ name: 'Frontend' }], [{ name: 'Old card' }]]
    h.upsertJob.mockResolvedValue({ id: 'job-1', status: 'queued' })
    const res = await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Ship  it' })
    expect(res).toMatchObject({ ok: true, jobId: 'job-1', alreadyRequested: false })
    const [user, spec] = h.upsertJob.mock.calls[0]
    expect(user).toBe(OWNER)
    expect(spec.kind).toBe('card_tree')
    expect(spec.externalKey).toBe(cardTreeJobKey(PROJECT, 'ship it'))
    expect(spec.externalKey).toMatch(new RegExp(`^card_tree:${PROJECT}:[0-9a-f]{16}$`))
    expect(spec.input.context).toMatchObject({ projectId: PROJECT, labels: ['Frontend'], openCards: ['Old card'] })
    expect(spec.input.prompt).toContain('To do → Done')
  })

  it('returns the open job when the same goal is still waiting', async () => {
    process.env.KAIROS_CARD_TREE = '1'
    h.findProjectBasic.mockResolvedValue({ id: PROJECT, name: 'Beta' })
    h.selects = [[], [], [], [{ id: 'job-old', status: 'queued' }]]
    expect(await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Ship it' })).toMatchObject({ ok: true, jobId: 'job-old', alreadyRequested: true })
    expect(h.upsertJob).not.toHaveBeenCalled()
  })

  it('asks again under a fresh key when the same goal already finished, failed or expired', async () => {
    process.env.KAIROS_CARD_TREE = '1'
    h.findProjectBasic.mockResolvedValue({ id: PROJECT, name: 'Beta' })
    h.selects = [[], [], [], [{ id: 'job-old', status: 'done' }], [{ n: 0 }]]
    h.upsertJob.mockResolvedValue({ id: 'job-new', status: 'queued' })
    expect(await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Ship it' })).toMatchObject({ ok: true, jobId: 'job-new', alreadyRequested: false })
    expect(h.upsertJob.mock.calls[0][1].externalKey).toMatch(new RegExp(`^${cardTreeJobKey(PROJECT, 'Ship it')}:[0-9a-z]+$`))
  })

  it('refuses a new goal while three are already waiting', async () => {
    process.env.KAIROS_CARD_TREE = '1'
    h.findProjectBasic.mockResolvedValue({ id: PROJECT, name: 'Beta' })
    h.selects = [[], [], [], [], [{ n: 3 }]]
    expect(await requestCardTree(OWNER, { projectId: PROJECT, goal: 'Another goal' })).toMatchObject({ ok: false, reason: 'busy' })
    expect(h.upsertJob).not.toHaveBeenCalled()
  })
})

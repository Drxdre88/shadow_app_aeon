import { describe, it, expect, vi, beforeEach } from 'vitest'

// A card that changes project must shed everything that only made sense in
// the old one: its timeline link and its Chronos lane. The db is a recording
// mock that captures every UPDATE's patch, so the transfer contract is pinned
// on the payload itself rather than on a round trip.

const state = vi.hoisted(() => ({ sets: [] as Record<string, unknown>[], transactions: 0 }))

vi.mock('@/lib/db', () => {
  function updateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      state.sets.push(patch)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => Promise.resolve([{ id: 'task-1' }])
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  const conn = { update: vi.fn(() => updateChain()) }
  return {
    db: {
      ...conn,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        state.transactions += 1
        return fn(conn)
      }),
    },
  }
})

vi.mock('@/lib/actions/helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectOwnership: vi.fn(), findProjectsWithRealmName: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn(), createTask: vi.fn(), findTasksByColumn: vi.fn(), deleteTasksByColumn: vi.fn() }))
vi.mock('@/lib/data/columns', () => ({ findColumns: vi.fn(), createColumn: vi.fn(), deleteColumn: vi.fn() }))
vi.mock('@/lib/data/checklist', () => ({ findChecklistItems: vi.fn(), createChecklistItemsBatch: vi.fn(), findChecklistItemsBatch: vi.fn() }))
vi.mock('@/lib/data/activity', () => ({ emitActivity: vi.fn().mockResolvedValue(undefined) }))

import { requireAuth } from '@/lib/actions/helpers'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { findColumns } from '@/lib/data/columns'
import { emitActivity } from '@/lib/data/activity'
import { moveTaskToProject, moveColumnToProject } from '../transfer'

const SOURCE = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
const TASK = '33333333-3333-4333-8333-333333333333'
const COLUMN = '44444444-4444-4444-8444-444444444444'
const TARGET_COLUMN = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  vi.clearAllMocks()
  state.sets.length = 0
  state.transactions = 0
  vi.mocked(requireAuth).mockResolvedValue('user-1')
  vi.mocked(verifyProjectOwnership).mockImplementation(async (id: string) => ({ id, name: id === TARGET ? 'Target' : 'Source' }) as never)
  vi.mocked(findTaskById).mockResolvedValue({ id: TASK, name: 'Card' } as never)
  vi.mocked(findColumns).mockImplementation(async (projectId: string) =>
    (projectId === SOURCE
      ? [{ id: COLUMN, name: 'Doing', color: 'blue', icon: null, orderIndex: 0 }]
      : [{ id: TARGET_COLUMN, name: 'Inbox', color: 'gray', icon: null, orderIndex: 2 }]) as never,
  )
})

describe('moveTaskToProject', () => {
  it('re-homes the card and drops its timeline link and Chronos lane in the same patch', async () => {
    await expect(moveTaskToProject(TASK, SOURCE, TARGET)).resolves.toEqual({ id: 'task-1' })

    expect(state.sets).toHaveLength(1)
    const patch = state.sets[0]
    expect('ownerResourceId' in patch).toBe(true)
    expect(patch).toMatchObject({
      projectId: TARGET,
      columnId: TARGET_COLUMN,
      status: 'todo',
      onTimeline: false,
      ganttTaskId: null,
      ownerResourceId: null,
    })
    expect(patch.updatedAt).toBeInstanceOf(Date)
    expect(emitActivity).toHaveBeenCalledTimes(2)
  })

  it('lands in the requested target column when one is given', async () => {
    await moveTaskToProject(TASK, SOURCE, TARGET, COLUMN)
    expect(state.sets[0]).toMatchObject({ columnId: COLUMN, ownerResourceId: null })
  })

  it('refuses before writing when either project is not the caller\'s', async () => {
    vi.mocked(verifyProjectOwnership).mockImplementation(async (id: string) => (id === TARGET ? null : { id, name: 'Source' }) as never)
    await expect(moveTaskToProject(TASK, SOURCE, TARGET)).rejects.toThrow('Target project not found')
    expect(state.sets).toHaveLength(0)
  })
})

describe('moveColumnToProject', () => {
  it('re-homes every card of the column with its timeline link and Chronos lane dropped, in one transaction', async () => {
    await expect(moveColumnToProject(COLUMN, SOURCE, TARGET)).resolves.toEqual({ id: COLUMN, name: 'Doing' })

    expect(state.transactions).toBe(1)
    expect(state.sets).toHaveLength(2)
    const [tasksPatch, columnPatch] = state.sets
    expect('ownerResourceId' in tasksPatch).toBe(true)
    expect(tasksPatch).toMatchObject({ projectId: TARGET, onTimeline: false, ganttTaskId: null, ownerResourceId: null })
    expect(tasksPatch.updatedAt).toBeInstanceOf(Date)
    expect(columnPatch).toEqual({ projectId: TARGET, orderIndex: 3 })
    expect(emitActivity).toHaveBeenCalledTimes(2)
  })

  it('refuses an unknown column before opening a transaction', async () => {
    await expect(moveColumnToProject(TARGET_COLUMN, SOURCE, TARGET)).rejects.toThrow('Column not found')
    expect(state.transactions).toBe(0)
    expect(state.sets).toHaveLength(0)
  })
})

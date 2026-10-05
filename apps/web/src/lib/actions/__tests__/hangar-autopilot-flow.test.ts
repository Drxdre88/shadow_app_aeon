import { describe, it, expect, beforeEach, vi } from 'vitest'

// Plan-then-approve, end to end at the action level: an in-memory card and
// session table stand in for the DB, so the gate state each verb writes is
// the state the next verb reads. createAgentSession models the partial unique
// index (one live mission per card), the authoritative launch guard.

const store = vi.hoisted(() => ({
  hangar: {} as Record<string, unknown>,
  live: [] as Array<{ id: string; taskId: string; status: string }>,
  steps: [] as string[],
  nextId: 0,
}))

vi.mock('@/lib/actions/helpers', () => ({ requireEditor: vi.fn(async () => 'user-1'), requireOwner: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({
  findTaskById: vi.fn(async (id: string, projectId: string) => ({ id, projectId, name: 'Autopilot', metadata: { hangar: { ...store.hangar } } })),
  updateTask: vi.fn(),
  recordMissionLaunch: vi.fn(),
}))
vi.mock('@/lib/data/sessions', () => ({
  findLiveSessionForTask: vi.fn(async (taskId: string) => store.live.find((s) => s.taskId === taskId) ?? null),
  createAgentSession: vi.fn(async (_userId: string, input: { taskId: string }) => {
    await Promise.resolve()
    if (store.live.some((s) => s.taskId === input.taskId)) {
      throw new Error('This card already has a live mission — kill it before launching again')
    }
    const row = { id: `00000000-0000-4000-8000-${String(++store.nextId).padStart(12, '0')}`, taskId: input.taskId, status: 'queued' }
    store.live.push(row)
    return row
  }),
}))
vi.mock('@/lib/data/hangar-autopilot', () => ({
  createFollowUpMissionCards: vi.fn(),
  findCardSession: vi.fn(),
  findFollowUpColumnId: vi.fn(),
  findPlanSteps: vi.fn(async () => [...store.steps]),
  patchCardHangar: vi.fn(async (_taskId: string, _projectId: string, patch: Record<string, unknown>) => {
    Object.assign(store.hangar, patch)
  }),
}))
vi.mock('@/lib/data/hangar-repos', () => ({ findHangarRepoBySlug: vi.fn(), listHangarRepos: vi.fn() }))
vi.mock('@/lib/data/workspaces', () => ({ findProjectRealmIds: vi.fn(async () => []) }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: vi.fn(async () => ({ project: { dominionId: null }, role: 'owner' })) }))
vi.mock('@/lib/data/dominions', () => ({ findDominionById: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { approvePlanAndBuild, revisePlan } from '../hangar-autopilot'
import { createAgentSession } from '@/lib/data/sessions'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const PLAN_SESSION = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  store.hangar = {
    objective: 'implement',
    repo: 'aeon',
    agent: 'copilot',
    model: null,
    instruction: 'Ship the autopilot.',
    outputMode: 'auto',
    autoRun: false,
    planFirst: true,
    sessionIds: [PLAN_SESSION],
    planGate: { status: 'awaiting_approval', sessionId: PLAN_SESSION },
  }
  store.live = []
  store.steps = ['Add schema', 'Write tests']
  store.nextId = 0
})

describe('plan-then-approve flow', () => {
  it('a revision puts the plan back into planning, so approving it says no plan is waiting', async () => {
    await revisePlan(PROJECT, TASK, 'Split the migration out')
    expect(store.hangar.planGate).toMatchObject({ status: 'planning', sessionId: store.live[0].id })

    await expect(approvePlanAndBuild(PROJECT, TASK)).rejects.toThrow('This card has no plan waiting for approval')
    expect(createAgentSession).toHaveBeenCalledTimes(1)
  })

  it('a second approval racing a live build hits the one-live-mission guard and launches nothing', async () => {
    const outcomes = await Promise.allSettled([approvePlanAndBuild(PROJECT, TASK), approvePlanAndBuild(PROJECT, TASK)])

    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected')
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0].reason)).toMatch(/already has a (live|queued) mission/)
    expect(store.live).toHaveLength(1)
    expect(store.hangar.planGate).toMatchObject({ status: 'approved', buildSessionId: store.live[0].id })
  })

  it('once the build is live and approved, a later approval is refused before any launch', async () => {
    await approvePlanAndBuild(PROJECT, TASK)
    await expect(approvePlanAndBuild(PROJECT, TASK)).rejects.toThrow('no plan waiting for approval')
    expect(createAgentSession).toHaveBeenCalledTimes(1)
  })
})

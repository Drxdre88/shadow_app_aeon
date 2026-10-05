import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({ requireEditor: vi.fn(), requireOwner: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn(), updateTask: vi.fn(), recordMissionLaunch: vi.fn() }))
vi.mock('@/lib/data/sessions', () => ({ createAgentSession: vi.fn(), findLiveSessionForTask: vi.fn() }))
vi.mock('@/lib/data/hangar-repos', () => ({ findHangarRepoBySlug: vi.fn(), listHangarRepos: vi.fn() }))
vi.mock('@/lib/data/workspaces', () => ({ findProjectRealmIds: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ mergeProjectSettings: vi.fn(), verifyProjectAccess: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionById: vi.fn() }))
vi.mock('@/lib/data/columns', () => ({ findColumns: vi.fn() }))
vi.mock('@/lib/data/hangar-autopilot', () => ({
  createFollowUpMissionCards: vi.fn(),
  findCardSession: vi.fn(),
  findFollowUpColumnId: vi.fn(),
  findPlanSteps: vi.fn(),
  patchCardHangar: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireEditor } from '@/lib/actions/helpers'
import { findTaskById } from '@/lib/data/tasks'
import { createAgentSession, findLiveSessionForTask } from '@/lib/data/sessions'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { verifyProjectAccess } from '@/lib/data/projects'
import {
  createFollowUpMissionCards,
  findCardSession,
  findFollowUpColumnId,
  findPlanSteps,
  patchCardHangar,
} from '@/lib/data/hangar-autopilot'
import {
  answerAndRelaunch,
  approvePlanAndBuild,
  createFollowUpCards,
  requeueMission,
  revisePlan,
} from '../hangar-autopilot'
import { spawnSessionFromCard } from '../hangar'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const LAST = '33333333-3333-4333-8333-333333333333'
const NEW = '44444444-4444-4444-8444-444444444444'

const mission = (extra: Record<string, unknown> = {}) => ({
  objective: 'implement',
  repo: 'aeon',
  agent: 'copilot',
  model: null,
  instruction: 'Ship the autopilot.',
  outputMode: 'auto',
  autoRun: false,
  sessionIds: [LAST],
  ...extra,
})
const card = (hangar: Record<string, unknown>) => ({ id: TASK, projectId: PROJECT, name: 'Autopilot', metadata: { hangar } })
const launched = () => vi.mocked(createAgentSession).mock.calls[0][1]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(findTaskById).mockResolvedValue(card(mission()) as never)
  vi.mocked(findLiveSessionForTask).mockResolvedValue(null as never)
  vi.mocked(findProjectRealmIds).mockResolvedValue([])
  vi.mocked(verifyProjectAccess).mockResolvedValue({ project: { dominionId: null }, role: 'owner' } as never)
  vi.mocked(createAgentSession).mockResolvedValue({ id: NEW, status: 'queued' } as never)
})

describe('plan-then-approve launch', () => {
  it('runs the plan objective first when the card asks for plan approval', async () => {
    vi.mocked(findTaskById).mockResolvedValue(card(mission({ planFirst: true })) as never)
    await spawnSessionFromCard(PROJECT, TASK)

    expect(launched().metadata).toEqual({ hangar: expect.objectContaining({ objective: 'plan', phase: 'plan' }) })
    expect(launched().prompt).toContain('objective=plan')
    expect(launched().prompt).toContain('PLANNING STEP ONLY')
    expect(launched().prompt).toContain('objective = implement')
    expect(patchCardHangar).toHaveBeenCalledWith(TASK, PROJECT, { planGate: expect.objectContaining({ status: 'planning', sessionId: NEW }) })
  })

  it('approves the (possibly edited) Plan checklist and launches the build with it', async () => {
    vi.mocked(findTaskById).mockResolvedValue(card(mission({ planFirst: true, planGate: { status: 'awaiting_approval', sessionId: LAST } })) as never)
    vi.mocked(findPlanSteps).mockResolvedValue(['Add schema', 'Write tests'])

    await approvePlanAndBuild(PROJECT, TASK)

    expect(launched().metadata).toEqual({ hangar: expect.objectContaining({ objective: 'implement', phase: 'build' }) })
    expect(launched().prompt).toContain('The owner approved this plan')
    expect(launched().prompt).toContain('1. Add schema\n2. Write tests')
    expect(patchCardHangar).toHaveBeenLastCalledWith(TASK, PROJECT, { planGate: expect.objectContaining({ status: 'approved', buildSessionId: NEW }) })
  })

  it('refuses approval when no plan is waiting', async () => {
    await expect(approvePlanAndBuild(PROJECT, TASK)).rejects.toThrow('no plan waiting for approval')
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('revises the plan with the owner note and the previous plan', async () => {
    vi.mocked(findTaskById).mockResolvedValue(card(mission({ planFirst: true, planGate: { status: 'awaiting_approval' } })) as never)
    vi.mocked(findPlanSteps).mockResolvedValue(['Old step'])

    await revisePlan(PROJECT, TASK, 'Split the migration out')

    expect(launched().metadata).toEqual({ hangar: expect.objectContaining({ objective: 'plan', phase: 'plan' }) })
    expect(launched().prompt).toContain("Owner's note: Split the migration out")
    expect(launched().prompt).toContain('1. Old step')
    await expect(revisePlan(PROJECT, TASK, '   ')).rejects.toThrow()
  })
})

describe('requeueMission', () => {
  it('relaunches a timed-out run with the same phase and context', async () => {
    vi.mocked(findCardSession).mockResolvedValue({ id: LAST, status: 'timeout', metadata: { hangar: { phase: 'build', context: 'Approved plan: 1. A' } } } as never)
    await requeueMission(PROJECT, TASK)

    expect(findCardSession).toHaveBeenCalledWith(LAST, TASK)
    expect(launched().metadata).toEqual({ hangar: expect.objectContaining({ objective: 'implement', phase: 'build', context: 'Approved plan: 1. A' }) })
  })

  it('refuses when the last run did not stop', async () => {
    vi.mocked(findCardSession).mockResolvedValue({ id: LAST, status: 'succeeded', metadata: {} } as never)
    await expect(requeueMission(PROJECT, TASK)).rejects.toThrow('Only a mission whose last run stopped')
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('keeps the one-live-mission guard', async () => {
    vi.mocked(findCardSession).mockResolvedValue({ id: LAST, status: 'killed', metadata: {} } as never)
    vi.mocked(findLiveSessionForTask).mockResolvedValue({ id: 'other', status: 'queued' } as never)
    await expect(requeueMission(PROJECT, TASK)).rejects.toThrow('already has a queued mission')
  })
})

describe('answerAndRelaunch', () => {
  it('appends the answers and the previous summary to the next instruction', async () => {
    vi.mocked(findTaskById).mockResolvedValue(card(mission({ lastResult: { status: 'needs_input', summary: 'Blocked on naming.' } })) as never)
    vi.mocked(findCardSession).mockResolvedValue({ id: LAST, status: 'succeeded', metadata: { hangar: { objective: 'implement' } } } as never)

    await answerAndRelaunch(PROJECT, TASK, [{ question: 'Which name?', answer: 'Use Autopilot' }])

    expect(launched().prompt).toContain('Summary of the previous run: Blocked on naming.')
    expect(launched().prompt).toContain('Q: Which name?\nA: Use Autopilot')
    expect(launched().metadata).toEqual({ hangar: expect.not.objectContaining({ phase: expect.anything() }) })
    await expect(answerAndRelaunch(PROJECT, TASK, [])).rejects.toThrow()
  })
})

describe('createFollowUpCards', () => {
  it('creates only the chosen recommended follow-ups in the intake column', async () => {
    const recommended = [
      { title: 'One', objective: 'implement', instruction: 'a' },
      { title: 'Two', objective: 'recon', instruction: 'b' },
    ]
    vi.mocked(findTaskById).mockResolvedValue(card(mission({ lastResult: { recommended_tasks: recommended } })) as never)
    vi.mocked(findFollowUpColumnId).mockResolvedValue('col-backlog')
    vi.mocked(createFollowUpMissionCards).mockResolvedValue([{ id: 'n2', name: 'Two' }] as never)

    const created = await createFollowUpCards(PROJECT, TASK, [1, 1, 7])

    expect(created).toEqual([{ id: 'n2', name: 'Two' }])
    expect(createFollowUpMissionCards).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK, projectId: PROJECT, name: 'Autopilot' }),
      [recommended[1]],
      'col-backlog',
    )
  })

  it('refuses when none of the picks exist and requires editor rights first', async () => {
    await expect(createFollowUpCards(PROJECT, TASK, [3])).rejects.toThrow('None of the chosen follow-ups exist')
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(createFollowUpCards(PROJECT, TASK, [0])).rejects.toThrow('Viewers cannot modify')
    expect(createFollowUpMissionCards).not.toHaveBeenCalled()
  })
})

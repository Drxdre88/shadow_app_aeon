import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireEditor: vi.fn(),
  requireOwner: vi.fn(),
}))

vi.mock('@/lib/data/tasks', () => ({
  findTaskById: vi.fn(),
  updateTask: vi.fn(),
  recordMissionLaunch: vi.fn(),
}))

vi.mock('@/lib/data/sessions', () => ({
  createAgentSession: vi.fn(),
  findLiveSessionForTask: vi.fn(),
}))

vi.mock('@/lib/data/hangar-repos', () => ({
  findHangarRepoBySlug: vi.fn(),
  listHangarRepos: vi.fn(),
}))

vi.mock('@/lib/data/workspaces', () => ({ findProjectRealmIds: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ mergeProjectSettings: vi.fn() }))
vi.mock('@/lib/data/columns', () => ({ findColumns: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { requireEditor } from '@/lib/actions/helpers'
import { findTaskById, recordMissionLaunch } from '@/lib/data/tasks'
import { createAgentSession, findLiveSessionForTask } from '@/lib/data/sessions'
import { findHangarRepoBySlug, listHangarRepos } from '@/lib/data/hangar-repos'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { spawnSessionFromCard } from '../hangar'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const REALM = '33333333-3333-4333-8333-333333333333'
const SESSION = '44444444-4444-4444-8444-444444444444'

const storedMission = {
  objective: 'recon',
  repo: 'shadow_app_aeon',
  agent: 'codex',
  model: 'gpt-5.6-sol',
  instruction: 'Map the repository and report the launch boundaries.',
  outputMode: 'auto',
  autoRun: true,
  subagents: ['prowler'],
  sessionIds: [],
}

const storedTask = (hangar: unknown = storedMission) => ({
  id: TASK,
  projectId: PROJECT,
  name: 'Repository launch research',
  metadata: { unrelated: 'preserved', hangar },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireEditor).mockResolvedValue('user-1')
  vi.mocked(findTaskById).mockResolvedValue(storedTask() as never)
  vi.mocked(findLiveSessionForTask).mockResolvedValue(null as never)
  vi.mocked(findProjectRealmIds).mockResolvedValue([])
  vi.mocked(findHangarRepoBySlug).mockResolvedValue(null as never)
  vi.mocked(listHangarRepos).mockResolvedValue([])
  vi.mocked(createAgentSession).mockResolvedValue({ id: SESSION, status: 'queued' } as never)
  vi.mocked(recordMissionLaunch).mockResolvedValue(storedTask({ ...storedMission, autoRun: false }) as never)
})

describe('spawnSessionFromCard', () => {
  it('authorizes, rereads the stored mission, links the session, then records disarming', async () => {
    const session = await spawnSessionFromCard(PROJECT, TASK)

    expect(requireEditor).toHaveBeenCalledWith(PROJECT)
    expect(findTaskById).toHaveBeenCalledWith(TASK, PROJECT)
    expect(vi.mocked(requireEditor).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(findTaskById).mock.invocationCallOrder[0]
    )
    expect(createAgentSession).toHaveBeenCalledWith('user-1', expect.objectContaining({
      engine: 'codex',
      repo: 'shadow_app_aeon',
      goal: 'Repository launch research',
      projectId: PROJECT,
      taskId: TASK,
      metadata: {
        hangar: {
          objective: 'recon',
          model: 'gpt-5.6-sol',
          subagents: ['prowler'],
          outputMode: 'auto',
          repo: 'shadow_app_aeon',
        },
      },
    }))
    const input = vi.mocked(createAgentSession).mock.calls[0][1]
    expect(input.prompt).toContain(`task_id=${TASK}`)
    expect(input.prompt).toContain('objective=recon')
    expect(input.prompt).toContain(storedMission.instruction)
    expect(recordMissionLaunch).toHaveBeenCalledWith(TASK, PROJECT, SESSION, expect.any(String))
    expect(vi.mocked(createAgentSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(recordMissionLaunch).mock.invocationCallOrder[0]
    )
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
    expect(session).toMatchObject({ id: SESSION, status: 'queued' })
  })

  it('stops at authorization failure before reading the card', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))

    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('Viewers cannot modify')
    expect(findTaskById).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('rejects invalid stored metadata before duplicate, registry, or session work', async () => {
    vi.mocked(findTaskById).mockResolvedValue(storedTask({ objective: 'recon', repo: '' }) as never)

    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('Card is not a valid Hangar mission')
    expect(findLiveSessionForTask).not.toHaveBeenCalled()
    expect(findProjectRealmIds).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('requires the database copy to be armed for an auto-drop launch', async () => {
    vi.mocked(findTaskById).mockResolvedValue(storedTask({ ...storedMission, autoRun: false }) as never)

    await expect(spawnSessionFromCard(PROJECT, TASK, 'auto-drop')).rejects.toThrow('not armed for auto-run')
    expect(findLiveSessionForTask).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('rejects a live duplicate before making registry calls', async () => {
    vi.mocked(findLiveSessionForTask).mockResolvedValue({ id: 'live-1', status: 'running' } as never)

    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('already has a running mission')
    expect(findProjectRealmIds).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('rejects a repo absent from an adopted realm registry', async () => {
    vi.mocked(findProjectRealmIds).mockResolvedValue([REALM])
    vi.mocked(listHangarRepos).mockResolvedValue([{ slug: 'another-repo' }] as never)

    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('is not in the Hangar registry')
    expect(findHangarRepoBySlug).toHaveBeenCalledWith(REALM, 'shadow_app_aeon')
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('accepts a registered active repo only when its engine is permitted', async () => {
    vi.mocked(findProjectRealmIds).mockResolvedValue([REALM])
    vi.mocked(findHangarRepoBySlug).mockResolvedValue({
      slug: 'shadow_app_aeon',
      active: true,
      allowedEngines: ['codex'],
    } as never)

    await expect(spawnSessionFromCard(PROJECT, TASK)).resolves.toMatchObject({ id: SESSION })
    expect(listHangarRepos).not.toHaveBeenCalled()

    vi.mocked(createAgentSession).mockClear()
    vi.mocked(recordMissionLaunch).mockClear()
    vi.mocked(findHangarRepoBySlug).mockResolvedValue({
      slug: 'shadow_app_aeon',
      active: true,
      allowedEngines: ['copilot'],
    } as never)
    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('Engine "codex" is not allowed')
    expect(createAgentSession).not.toHaveBeenCalled()
    expect(recordMissionLaunch).not.toHaveBeenCalled()
  })

  it('documents partial launch: the queued session survives a failed disarm', async () => {
    vi.mocked(recordMissionLaunch).mockRejectedValue(new Error('database write failed'))

    await expect(spawnSessionFromCard(PROJECT, TASK)).rejects.toThrow('database write failed')
    expect(createAgentSession).toHaveBeenCalledOnce()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({ requireMemberAccess: vi.fn() }))
vi.mock('@/lib/data/hangar-repos', () => ({
  createHangarRepo: vi.fn(),
  findHangarRepoById: vi.fn(),
  listHangarRepos: vi.fn(),
  updateHangarRepo: vi.fn(),
}))
vi.mock('@/lib/data/workspaces', () => ({
  findGroupsForUser: vi.fn(),
  findProjectRealmIds: vi.fn(),
  getGroupRole: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { requireMemberAccess } from '@/lib/actions/helpers'
import {
  createHangarRepo,
  findHangarRepoById,
  listHangarRepos,
  updateHangarRepo,
} from '@/lib/data/hangar-repos'
import { findGroupsForUser, findProjectRealmIds, getGroupRole } from '@/lib/data/workspaces'
import {
  addProjectHangarRepository,
  editProjectHangarRepository,
  getProjectHangarRepositoryRegistry,
} from '../hangar-repositories'

const PROJECT = 'fc97e2ad-5f2e-46eb-bc03-745454cb463c'
const REALM_A = '7db4d58b-3953-4ff0-8f29-2701598e9ec7'
const REALM_B = 'cfaf9999-ae09-457c-b2f6-9e383117dc84'
const OTHER_REALM = '87a8cf8c-4ec7-47ec-b03c-63f598d05b63'
const REPO = 'f3c46a30-6fe5-40ef-ab31-fb546135fe30'

const registryRow = (realmId: string, slug: string) => ({
  id: REPO,
  realmId,
  slug,
  name: slug === 'aeon' ? 'Aeon' : 'Swarm',
  gitUrl: `https://github.com/example/${slug}.git`,
  ghSlug: null,
  defaultBranch: 'main',
  branchPrefix: 'aeon/',
  allowedEngines: ['copilot'],
  runCmd: null,
  envSetupCmd: null,
  appUrl: null,
  notes: null,
  active: true,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireMemberAccess).mockResolvedValue({ userId: 'user-1', role: 'editor' } as never)
  vi.mocked(findProjectRealmIds).mockResolvedValue([REALM_A, REALM_B])
  vi.mocked(findGroupsForUser).mockResolvedValue([
    { id: REALM_A, name: 'Operations', memberRole: 'owner' },
    { id: REALM_B, name: 'Research', memberRole: 'viewer' },
  ] as never)
  vi.mocked(getGroupRole).mockResolvedValue('editor')
})

describe('Hangar repository actions', () => {
  it('requires project access before loading any registry data', async () => {
    vi.mocked(requireMemberAccess).mockRejectedValue(new Error('Unauthorized'))

    await expect(getProjectHangarRepositoryRegistry(PROJECT)).rejects.toThrow('Unauthorized')

    expect(findProjectRealmIds).not.toHaveBeenCalled()
    expect(listHangarRepos).not.toHaveBeenCalled()
  })

  it('loads every attached realm and preserves realm-specific management rights', async () => {
    vi.mocked(listHangarRepos)
      .mockResolvedValueOnce([registryRow(REALM_A, 'aeon')] as never)
      .mockResolvedValueOnce([registryRow(REALM_B, 'swarm')] as never)

    const result = await getProjectHangarRepositoryRegistry(PROJECT)

    expect(result.realms).toEqual([
      expect.objectContaining({ id: REALM_A, name: 'Operations', canManage: true }),
      expect.objectContaining({ id: REALM_B, name: 'Research', canManage: false }),
    ])
    expect(result.repositories).toEqual([
      expect.objectContaining({ slug: 'aeon', realmName: 'Operations', canManage: true }),
      expect.objectContaining({ slug: 'swarm', realmName: 'Research', canManage: false }),
    ])
  })

  it('does not expose an attached realm registry to a project member outside that realm', async () => {
    vi.mocked(findGroupsForUser).mockResolvedValue([
      { id: REALM_A, name: 'Operations', memberRole: 'editor' },
    ] as never)
    vi.mocked(listHangarRepos).mockResolvedValue([registryRow(REALM_A, 'aeon')] as never)

    const result = await getProjectHangarRepositoryRegistry(PROJECT)

    expect(result.realms).toHaveLength(1)
    expect(result.realms[0].id).toBe(REALM_A)
    expect(listHangarRepos).toHaveBeenCalledOnce()
    expect(listHangarRepos).toHaveBeenCalledWith(REALM_A)
  })

  it('refuses to add a repository to a realm outside the project', async () => {
    await expect(addProjectHangarRepository(PROJECT, {
      realmId: OTHER_REALM,
      slug: 'aeon',
      name: 'Aeon',
      gitUrl: 'https://github.com/example/aeon.git',
    })).rejects.toThrow('Realm is not attached to this project')

    expect(getGroupRole).not.toHaveBeenCalled()
    expect(createHangarRepo).not.toHaveBeenCalled()
  })

  it('rejects a registry slug that mission cards cannot safely target', async () => {
    await expect(addProjectHangarRepository(PROJECT, {
      realmId: REALM_A,
      slug: 'my repo',
      name: 'Aeon',
      gitUrl: 'https://github.com/example/aeon.git',
    })).rejects.toThrow('Invalid repo slug')

    expect(getGroupRole).not.toHaveBeenCalled()
    expect(createHangarRepo).not.toHaveBeenCalled()
  })

  it('blocks viewers from adding registry entries', async () => {
    vi.mocked(getGroupRole).mockResolvedValue('viewer')

    await expect(addProjectHangarRepository(PROJECT, {
      realmId: REALM_A,
      slug: 'aeon',
      name: 'Aeon',
      gitUrl: 'https://github.com/example/aeon.git',
    })).rejects.toThrow('Viewers cannot modify the Hangar registry')

    expect(createHangarRepo).not.toHaveBeenCalled()
  })

  it('rejects edits when the repository belongs to another realm', async () => {
    vi.mocked(findHangarRepoById).mockResolvedValue(registryRow(OTHER_REALM, 'aeon') as never)

    await expect(editProjectHangarRepository(PROJECT, REPO, { active: false }))
      .rejects.toThrow('Realm is not attached to this project')

    expect(updateHangarRepo).not.toHaveBeenCalled()
  })

  it('allows realm editors to retire an attached repository', async () => {
    vi.mocked(findHangarRepoById).mockResolvedValue(registryRow(REALM_A, 'aeon') as never)
    vi.mocked(updateHangarRepo).mockResolvedValue({ ...registryRow(REALM_A, 'aeon'), active: false } as never)

    await editProjectHangarRepository(PROJECT, REPO, { active: false })

    expect(updateHangarRepo).toHaveBeenCalledWith(REPO, { active: false })
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${PROJECT}`)
  })
})

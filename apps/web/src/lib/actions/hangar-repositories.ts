'use server'

import { revalidatePath } from 'next/cache'
import { requireMemberAccess } from './helpers'
import {
  createHangarRepo,
  findHangarRepoById,
  listHangarRepos,
  updateHangarRepo,
} from '@/lib/data/hangar-repos'
import {
  createHangarRepoSchema,
  updateHangarRepoSchema,
  type CreateHangarRepoInput,
  type UpdateHangarRepoInput,
} from '@/lib/data/validators'
import { findGroupsForUser, findProjectRealmIds, getGroupRole } from '@/lib/data/workspaces'

export interface HangarRepositoryRealm {
  id: string
  name: string
  canManage: boolean
}

export interface ProjectHangarRepository {
  id: string
  realmId: string
  realmName: string
  canManage: boolean
  slug: string
  name: string
  gitUrl: string
  defaultBranch: string
  allowedEngines: string[]
  active: boolean
}

export interface ProjectHangarRepositoryRegistry {
  realms: HangarRepositoryRealm[]
  repositories: ProjectHangarRepository[]
}

function canManageRegistry(role: string | null): boolean {
  return role === 'owner' || role === 'editor'
}

async function requireAttachedRealm(projectId: string, realmId: string): Promise<void> {
  const realmIds = await findProjectRealmIds(projectId)
  if (!realmIds.includes(realmId)) throw new Error('Realm is not attached to this project')
}

async function requireRegistryManager(projectId: string, realmId: string, userId: string): Promise<void> {
  await requireAttachedRealm(projectId, realmId)
  const role = await getGroupRole(realmId, userId)
  if (!role) throw new Error('Not a member of this realm')
  if (!canManageRegistry(role)) throw new Error('Viewers cannot modify the Hangar registry')
}

export async function getProjectHangarRepositoryRegistry(
  projectId: string,
): Promise<ProjectHangarRepositoryRegistry> {
  const { userId } = await requireMemberAccess(projectId)
  const realmIds = await findProjectRealmIds(projectId)
  const memberships = await findGroupsForUser(userId)
  const membershipById = new Map(memberships.map((realm) => [realm.id, realm]))

  const realms = realmIds.flatMap((id) => {
    const membership = membershipById.get(id)
    if (!membership) return []
    const role = membership?.memberRole ?? null
    return [{
      id,
      name: membership.name,
      canManage: canManageRegistry(role),
    }]
  })

  const realmById = new Map(realms.map((realm) => [realm.id, realm]))
  const registryRows = await Promise.all(realms.map((realm) => listHangarRepos(realm.id)))
  const repositories = registryRows.flat().map((repo) => {
    const realm = realmById.get(repo.realmId)
    return {
      id: repo.id,
      realmId: repo.realmId,
      realmName: realm?.name ?? `Realm ${repo.realmId.slice(0, 8)}`,
      canManage: realm?.canManage ?? false,
      slug: repo.slug,
      name: repo.name,
      gitUrl: repo.gitUrl,
      defaultBranch: repo.defaultBranch,
      allowedEngines: [...repo.allowedEngines],
      active: repo.active,
    }
  })

  return {
    realms,
    repositories: repositories.sort((a, b) =>
      a.realmName.localeCompare(b.realmName) || a.slug.localeCompare(b.slug)
    ),
  }
}

export async function addProjectHangarRepository(
  projectId: string,
  input: CreateHangarRepoInput,
): Promise<void> {
  const { userId } = await requireMemberAccess(projectId)
  const parsed = createHangarRepoSchema.parse(input)
  await requireRegistryManager(projectId, parsed.realmId, userId)
  await createHangarRepo(parsed)
  revalidatePath(`/project/${projectId}`)
}

export async function editProjectHangarRepository(
  projectId: string,
  repoId: string,
  input: UpdateHangarRepoInput,
): Promise<void> {
  const { userId } = await requireMemberAccess(projectId)
  const existing = await findHangarRepoById(repoId)
  if (!existing) throw new Error('Repository not found')
  await requireRegistryManager(projectId, existing.realmId, userId)
  const patch = updateHangarRepoSchema.parse(input)
  await updateHangarRepo(repoId, patch)
  revalidatePath(`/project/${projectId}`)
}

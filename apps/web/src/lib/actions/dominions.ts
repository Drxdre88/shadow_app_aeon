'use server'

import { requireAuth } from './helpers'
import {
  createDominionSchema,
  updateDominionSchema,
  addDominionRepoSchema,
  type CreateDominionInput,
  type UpdateDominionInput,
  type AddDominionRepoInput,
} from '@/lib/data/validators'
import {
  findDominionsByUser,
  findDominionById,
  createDominion as _createDominion,
  updateDominion as _updateDominion,
  deleteDominion as _deleteDominion,
  listDominionRepos,
  addDominionRepo as _addDominionRepo,
  removeDominionRepo as _removeDominionRepo,
} from '@/lib/data/dominions'

export async function getDominions() {
  const userId = await requireAuth()
  return findDominionsByUser(userId)
}

export async function getDominion(id: string) {
  const userId = await requireAuth()
  const row = await findDominionById(id, userId)
  if (!row) throw new Error('Dominion not found or unauthorized')
  return row
}

export async function createDominionAction(input: CreateDominionInput) {
  const userId = await requireAuth()
  const parsed = createDominionSchema.parse(input)
  return _createDominion(userId, parsed)
}

export async function updateDominionAction(id: string, patch: UpdateDominionInput) {
  const userId = await requireAuth()
  const parsed = updateDominionSchema.parse(patch)
  const row = await _updateDominion(id, userId, parsed)
  if (!row) throw new Error('Dominion not found or unauthorized')
  return row
}

export async function deleteDominionAction(id: string) {
  const userId = await requireAuth()
  const ok = await _deleteDominion(id, userId)
  if (!ok) throw new Error('Dominion not found or unauthorized')
  return { deleted: true }
}

export async function getDominionReposAction(dominionId: string) {
  const userId = await requireAuth()
  return listDominionRepos(dominionId, userId)
}

export async function addDominionRepoAction(input: AddDominionRepoInput) {
  const userId = await requireAuth()
  const parsed = addDominionRepoSchema.parse(input)
  const row = await _addDominionRepo(parsed.dominionId, userId, parsed.repoSlug)
  return row
}

export async function removeDominionRepoAction(input: AddDominionRepoInput) {
  const userId = await requireAuth()
  const parsed = addDominionRepoSchema.parse(input)
  const ok = await _removeDominionRepo(parsed.dominionId, userId, parsed.repoSlug)
  if (!ok) throw new Error('Repo mapping not found or unauthorized')
  return { removed: true }
}

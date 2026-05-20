'use server'

import { db } from '@/lib/db'
import { boardTasks, groupMembers, projects, memories as memoriesTable } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from './helpers'
import { verifyProjectAccess } from '@/lib/data/projects'
import {
  createMemorySchema,
  updateMemorySchema,
  searchMemoriesSchema,
  addLinkSchema,
  getNeighboursSchema,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type SearchMemoriesInput,
  type AddLinkInput,
  type GetNeighboursInput,
} from '@/lib/data/validators'
import {
  findMemoryById as _findMemoryById,
  listMemories as _listMemories,
  searchMemoriesFts as _searchMemoriesFts,
  getNeighbours as _getNeighbours,
  createMemory as _createMemory,
  updateMemory as _updateMemory,
  addLink as _addLink,
  removeLink as _removeLink,
  deleteMemory as _deleteMemory,
  targetMemoryExists,
} from '@/lib/data/memories'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 1 — server actions. Pattern: requireAuth → validate → verify
// anchor access (when supplied) → delegate. Memories are user-scoped, so
// touchProject() is NOT called on mutations.
// ─────────────────────────────────────────────────────────────────────────

async function verifyAnchors(
  userId: string,
  anchors: { realmId?: string | null; projectId?: string | null; taskId?: string | null }
) {
  if (anchors.realmId) {
    const [m] = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, anchors.realmId), eq(groupMembers.userId, userId)))
      .limit(1)
    if (!m) throw new Error('Realm not accessible')
  }
  if (anchors.projectId) {
    const access = await verifyProjectAccess(anchors.projectId, userId)
    if (!access) throw new Error('Project not accessible')
  }
  if (anchors.taskId) {
    const [t] = await db
      .select({ projectId: boardTasks.projectId })
      .from(boardTasks)
      .where(eq(boardTasks.id, anchors.taskId))
      .limit(1)
    if (!t) throw new Error('Task not found')
    const access = await verifyProjectAccess(t.projectId, userId)
    if (!access) throw new Error('Task not accessible')
  }
}

export async function getMemory(memoryId: string) {
  const userId = await requireAuth()
  return _findMemoryById(memoryId, userId)
}

type ListMemoriesOpts = {
  limit?: number
  offset?: number
  type?: string | string[]
  realmId?: string
  projectId?: string
  taskId?: string
  pinnedOnly?: boolean
  includeArchived?: boolean
}

export async function listMemoriesForUser(opts: ListMemoriesOpts = {}) {
  const userId = await requireAuth()
  return _listMemories(userId, opts)
}

export async function createMemory(input: CreateMemoryInput) {
  const userId = await requireAuth()
  const parsed = createMemorySchema.parse(input)
  await verifyAnchors(userId, parsed)

  // If any link points to a memory target, verify it exists and is owned by the user.
  if (parsed.links && parsed.links.length > 0) {
    for (const link of parsed.links) {
      if (link.target_kind === 'memory') {
        const ok = await targetMemoryExists(link.target, userId)
        if (!ok) throw new Error(`Target memory not found: ${link.target}`)
      }
    }
  }

  return _createMemory(userId, parsed)
}

export async function updateMemory(memoryId: string, patch: UpdateMemoryInput) {
  const userId = await requireAuth()
  const parsed = updateMemorySchema.parse(patch)
  await verifyAnchors(userId, parsed)
  const row = await _updateMemory(memoryId, userId, parsed)
  if (!row) throw new Error('Memory not found or unauthorized')
  return row
}

export async function searchMemories(input: SearchMemoriesInput) {
  const userId = await requireAuth()
  const parsed = searchMemoriesSchema.parse(input)
  return _searchMemoriesFts(userId, parsed)
}

export async function addLinkToMemory(memoryId: string, input: AddLinkInput) {
  const userId = await requireAuth()
  const parsed = addLinkSchema.parse(input)

  // For memory-target links, the linked memory must be owned by the user.
  if (parsed.targetKind === 'memory') {
    const ok = await targetMemoryExists(parsed.target, userId)
    if (!ok) throw new Error('Target memory not found')
  }
  // For task/project/realm targets we can leverage the same anchor verifier.
  if (parsed.targetKind === 'project' || parsed.targetKind === 'task' || parsed.targetKind === 'realm') {
    await verifyAnchors(userId, {
      projectId: parsed.targetKind === 'project' ? parsed.target : undefined,
      taskId:    parsed.targetKind === 'task'    ? parsed.target : undefined,
      realmId:   parsed.targetKind === 'realm'   ? parsed.target : undefined,
    })
  }

  const result = await _addLink(memoryId, userId, parsed)
  if (!result) throw new Error('Memory not found or unauthorized')
  return result
}

export async function removeLinkFromMemory(memoryId: string, linkIndex: number) {
  const userId = await requireAuth()
  const row = await _removeLink(memoryId, userId, linkIndex)
  if (!row) throw new Error('Memory or link not found')
  return row
}

export async function getMemoryNeighbours(memoryId: string, input: GetNeighboursInput) {
  const userId = await requireAuth()
  const parsed = getNeighboursSchema.parse(input)
  // Verify ownership of the seed memory upfront — the recursive walk already
  // filters by user_id but failing fast gives a clearer error.
  const seed = await _findMemoryById(memoryId, userId)
  if (!seed) throw new Error('Memory not found or unauthorized')

  const neighbours = await _getNeighbours(memoryId, userId, parsed)
  return { memory: seed, neighbours }
}

export async function deleteMemoryById(memoryId: string) {
  const userId = await requireAuth()
  const ok = await _deleteMemory(memoryId, userId)
  if (!ok) throw new Error('Memory not found or unauthorized')
  return { deleted: true }
}

// Stub for Phase 5 — broadcast memory events to a user-scoped Pusher channel.
// Kept here to lock the contract; the listener wiring lands in Phase 5.
export async function broadcastMemoryEvent(_userId: string, _event: { type: string; memoryId: string }) {
  // No-op in Phase 1.
}

// Cast-safe re-export of the table for callers that need it (e.g. parity test).
export { memoriesTable }

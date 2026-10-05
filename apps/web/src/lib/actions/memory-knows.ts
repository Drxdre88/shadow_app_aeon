'use server'

import { z } from 'zod'
import { requireAuth } from './helpers'
import { findMemoryById, updateMemory as _updateMemory } from '@/lib/data/memories'
import {
  confirmMemoryAsOwner,
  getMemoryProvenance,
  listKnownRows,
  listNeedsEyes,
  rejectMemoryAsWrong,
} from '@/lib/data/memory-knows'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'
import { isConstitutionRow } from '@/lib/kairos/constitution/amendment'
import { isGoalRow } from '@/lib/kairos/goals/guards'
import { getSensitiveGate, setSensitiveGate } from '@/lib/kairos/sensitive'

// "What Vorath knows" — the owner sees what Vorath believes, why, and fixes
// it. requireAuth → validate → refuse protected rows → lib/data. Memories are
// user-scoped, so touchProject() is not called.

const idSchema = z.string().uuid()
const editSchema = z.object({
  title: z.string().trim().min(1).max(255),
  bodyMd: z.string().trim().min(1).max(100_000),
})
const reasonSchema = z.string().trim().min(1).max(500)

const CONSTITUTION_REFUSAL = 'Vorath\u2019s constitution only changes through an amendment you accept in the inbox.'
const GOAL_REFUSAL = 'Goals change through the goal flow (approve, veto or close), not here.'
const BELIEF_EDIT_REFUSAL = 'Beliefs are rebuilt from your notes \u2014 confirm it or mark it wrong instead.'

type Row = Awaited<ReturnType<typeof findMemoryById>>

function protectedRefusal(row: NonNullable<Row>): string | null {
  if (isConstitutionRow(row)) return CONSTITUTION_REFUSAL
  if (isGoalRow(row)) return GOAL_REFUSAL
  return null
}

async function ownedRow(userId: string, memoryId: string): Promise<NonNullable<Row>> {
  const row = await findMemoryById(idSchema.parse(memoryId), userId)
  if (!row) throw new Error('Memory not found')
  return row
}

export async function listWhatVorathKnows() {
  const userId = await requireAuth()
  return listKnownRows(userId)
}

export async function listNeedsYourEyes() {
  const userId = await requireAuth()
  return listNeedsEyes(userId)
}

export async function getMemoryWhy(memoryId: string) {
  const userId = await requireAuth()
  const why = await getMemoryProvenance(userId, idSchema.parse(memoryId))
  if (!why) throw new Error('Memory not found')
  return why
}

// Edit in place through the shared updateMemory path with the operator's
// origin. That path never raises trust on its own: an agent-written row stays
// labelled agent until the owner also confirms it.
export async function editMemoryInPlace(memoryId: string, input: { title: string; bodyMd: string }) {
  const userId = await requireAuth()
  const row = await ownedRow(userId, memoryId)
  const refusal = protectedRefusal(row) ?? (row.type === 'belief' || row.streamClass === 'belief' ? BELIEF_EDIT_REFUSAL : null)
  if (refusal) throw new Error(refusal)
  const parsed = editSchema.parse(input)
  const updated = await _updateMemory(row.id, userId, parsed, { origin: { kind: 'operator', via: 'ui-fix' } })
  if (!updated) throw new Error('Memory not found')
  return updated
}

export async function markMemoryWrong(memoryId: string, reason: string) {
  const userId = await requireAuth()
  const row = await ownedRow(userId, memoryId)
  const refusal = protectedRefusal(row)
  if (refusal) throw new Error(refusal)
  const result = await rejectMemoryAsWrong(userId, row.id, reasonSchema.parse(reason))
  if (!result.ok) throw new Error(result.reason === 'already_archived' ? 'Already set aside' : 'Memory not found')
  return result
}

export async function removeNeedsEyesMemory(memoryId: string) {
  return markMemoryWrong(memoryId, 'Removed from Needs your eyes')
}

export async function confirmMemory(memoryId: string) {
  const userId = await requireAuth()
  const row = await ownedRow(userId, memoryId)
  const refusal = protectedRefusal(row)
  if (refusal) throw new Error(refusal)
  const result = await confirmMemoryAsOwner(userId, row.id)
  if (!result.ok) throw new Error('Memory not found')
  return result
}

export async function undoMemoryChange(opId: string) {
  const userId = await requireAuth()
  const result = await revertMemoryOp(userId, idSchema.parse(opId), { reason: 'owner undo from the memory panel' })
  if (!result.ok) {
    const copy: Record<typeof result.reason, string> = {
      not_found: 'That change no longer exists.',
      already_reverted: 'That change was already undone.',
      not_revertable: 'That change can\u2019t be undone.',
      memory_missing: 'The memory is gone.',
      stale: 'The memory changed since then, so this can\u2019t be undone safely.',
    }
    throw new Error(copy[result.reason])
  }
  return result
}

export async function getSensitiveGateSetting() {
  const userId = await requireAuth()
  return getSensitiveGate(userId)
}

export async function setSensitiveGateSetting(enabled: boolean) {
  const userId = await requireAuth()
  return setSensitiveGate(userId, z.boolean().parse(enabled))
}

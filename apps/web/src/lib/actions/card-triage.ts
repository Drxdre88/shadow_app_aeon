'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor, requireMember, requireOwner } from './helpers'
import { assertVorath, canUseVorath } from '@/lib/vorath-access'
import {
  findCardTriageBoard as _findCardTriageBoard,
  findTriageCard as _findTriageCard,
  replaceCardTriage as _replaceCardTriage,
  setProjectCardTriage as _setProjectCardTriage,
} from '@/lib/data/card-triage'
import { addLabelToTask as _addLabelToTask } from '@/lib/data/labels'
import { updateTask as _updateTask } from '@/lib/data/tasks'
import { emitActivity } from '@/lib/data/activity'
import { updateTaskSchema } from '@/lib/data/validators'
import { findTriageItem, withTriageStatus } from '@/lib/kairos/triage/resolve'
import {
  isCardTriageOn,
  readCardTriage,
  resolveTriageInputSchema,
  setCardTriageInputSchema,
  type CardTriage,
  type ResolveTriageInput,
} from '@/lib/kairos/triage/types'

// "Vorath sorts new cards": the owner-only per-board switch and the owner's
// Accept / Dismiss on each suggestion. Suggestions are never applied without
// an Accept here.

// Read by the board settings for every member: off, not a throw, outside Vorath.
export async function getCardTriageSetting(projectId: string) {
  const userId = await requireMember(projectId)
  if (!canUseVorath(userId)) return { on: false, canToggle: false }
  const board = await _findCardTriageBoard(projectId)
  if (!board) throw new Error('Project not found')
  return { on: isCardTriageOn(board.settings), canToggle: board.userId === userId }
}

export async function setCardTriage(projectId: string, on: boolean) {
  const userId = await requireOwner(projectId)
  assertVorath(userId)
  const parsed = setCardTriageInputSchema.parse({ on })
  // Scoped to the board's creator in SQL: a realm owner or member of a
  // shared board can't switch sorting on for someone else's cards.
  const project = await _setProjectCardTriage(projectId, userId, parsed.on)
  if (!project) throw new Error('Only the person who created this board can change card sorting')
  revalidatePath(`/project/${projectId}`)
  return { projectId, on: parsed.on }
}

const MAX_WRITE_TRIES = 2

export async function resolveCardTriage(
  projectId: string,
  taskId: string,
  input: ResolveTriageInput,
): Promise<{ triage: CardTriage; applied: boolean }> {
  const userId = await requireEditor(projectId)
  assertVorath(userId)
  const { kind, ref, decision } = resolveTriageInputSchema.parse(input)

  for (let attempt = 0; attempt < MAX_WRITE_TRIES; attempt++) {
    const card = await _findTriageCard(taskId, projectId)
    if (!card) throw new Error('Card not found')
    const raw = (card.metadata as Record<string, unknown> | null)?.triage
    const triage = readCardTriage(card.metadata)
    if (!triage) throw new Error('This card has no suggestions')
    const item = findTriageItem(triage, kind, ref)
    if (!item) throw new Error('That suggestion is no longer on the card')
    if (item.status !== 'pending') return { triage, applied: false }

    // Apply before recording the decision: both writes are idempotent, so a
    // lost race below at worst re-applies the same label or priority.
    let applied = false
    if (decision === 'accept' && kind === 'label') {
      try {
        await _addLabelToTask(taskId, item.ref, projectId)
      } catch {
        throw new Error('That label no longer exists on this board')
      }
      emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId: item.ref, taskId }, userId).catch(() => {})
      applied = true
    } else if (decision === 'accept' && kind === 'priority' && card.priority !== item.ref) {
      const task = await _updateTask(taskId, projectId, updateTaskSchema.parse({ priority: item.ref }))
      emitActivity(projectId, 'task', taskId, 'updated', task?.name, undefined, userId).catch(() => {})
      applied = true
    }

    const next = withTriageStatus(triage, kind, ref, decision === 'accept' ? 'accepted' : 'dismissed')
    if (!next) return { triage, applied }
    if (await _replaceCardTriage(taskId, projectId, raw, next)) {
      revalidatePath(`/project/${projectId}`)
      return { triage: next, applied }
    }
  }
  throw new Error('The card changed while saving — please try again')
}

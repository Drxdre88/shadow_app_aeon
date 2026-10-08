'use server'

import { revalidatePath } from 'next/cache'
import { requireMember, requireOwner } from './helpers'
import {
  findAiDoneBoard as _findAiDoneBoard,
  setProjectAiDone as _setProjectAiDone,
} from '@/lib/data/ai-done'
import { isAiDoneOn, setAiDoneInputSchema } from '@/lib/kairos/ai-done/types'
import { aiDoneEnabled } from '@/lib/kairos/ai-done/flag'

// "Vorath checks" (AI DONE cards): the owner-only per-board switch. App-only
// on purpose — no MCP or REST twin, so an agent can't switch on its own card writer.

export async function getAiDoneSetting(projectId: string) {
  const userId = await requireMember(projectId)
  const board = await _findAiDoneBoard(projectId)
  if (!board) throw new Error('Project not found')
  return { on: isAiDoneOn(board.settings), canToggle: board.userId === userId, available: aiDoneEnabled() }
}

export async function setAiDone(projectId: string, on: boolean) {
  const userId = await requireOwner(projectId)
  const parsed = setAiDoneInputSchema.parse({ on })
  const project = await _setProjectAiDone(projectId, userId, parsed.on)
  if (!project) throw new Error('Only the person who created this board can change Vorath checks')
  revalidatePath(`/project/${projectId}`)
  return { projectId, on: parsed.on }
}

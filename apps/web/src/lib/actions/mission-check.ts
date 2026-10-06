'use server'

import { revalidatePath } from 'next/cache'
import { requireMember, requireOwner } from './helpers'
import {
  findMissionCheckBoard as _findMissionCheckBoard,
  setProjectMissionCheck as _setProjectMissionCheck,
} from '@/lib/data/mission-check'
import { isMissionCheckOn, setMissionCheckInputSchema } from '@/lib/kairos/mission-check/types'
import { missionCheckMode } from '@/lib/kairos/mission-check/flag'

// "Vorath checks finished missions": the owner-only per-board switch. App-only
// on purpose — no MCP or REST twin, so an agent can't switch on its own grader.

export async function getMissionCheckSetting(projectId: string) {
  const userId = await requireMember(projectId)
  const board = await _findMissionCheckBoard(projectId)
  if (!board) throw new Error('Project not found')
  return { on: isMissionCheckOn(board.settings), canToggle: board.userId === userId, available: missionCheckMode() !== 'off' }
}

export async function setMissionCheck(projectId: string, on: boolean) {
  const userId = await requireOwner(projectId)
  const parsed = setMissionCheckInputSchema.parse({ on })
  const project = await _setProjectMissionCheck(projectId, userId, parsed.on)
  if (!project) throw new Error('Only the person who created this board can change mission checks')
  revalidatePath(`/project/${projectId}`)
  return { projectId, on: parsed.on }
}

import { useBoardStore } from '@/lib/store/boardStore'
import { triggerCelebration } from '@/components/celebrations'
import { findCardElement } from './popoverAnchor'

export type TriState = 'unchecked' | 'checked' | 'crossed'

export function nextTriState(s: TriState): TriState {
  if (s === 'unchecked') return 'checked'
  if (s === 'checked') return 'crossed'
  return 'unchecked'
}

export function triToStatus(tri: TriState, fallback: string): string {
  if (tri === 'checked') return 'done'
  if (tri === 'crossed') return 'todo'
  return fallback === 'done' ? 'todo' : fallback
}

export function getTriState(status: string, crossedTaskIds: Record<string, unknown>, taskId: string): TriState {
  return status === 'done' ? 'checked' : taskId in crossedTaskIds ? 'crossed' : 'unchecked'
}

/**
 * Advance a task's completion tri-state (unchecked → checked → crossed → unchecked)
 * and persist the resulting status. Shared by the card checkbox click and the board
 * "toggle done" hotkey so both paths stay in lockstep.
 */
export function cycleTaskCompletion(
  taskId: string,
  onPersist?: (taskId: string, updates: Record<string, unknown>) => void,
) {
  const s = useBoardStore.getState()
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return
  const next = nextTriState(getTriState(task.status, s.crossedTaskIds, taskId))
  if (next === 'crossed') s.addCrossedTask(taskId)
  else s.removeCrossedTask(taskId)
  const newStatus = triToStatus(next, task.status)
  s.updateTask(taskId, { status: newStatus })
  onPersist?.(taskId, { status: newStatus })
  if (newStatus === 'done') {
    const rect = findCardElement(taskId)?.getBoundingClientRect()
    if (rect) triggerCelebration(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
}

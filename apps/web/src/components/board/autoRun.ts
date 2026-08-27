import type { HangarBoardConfig } from '@/lib/store/hangarUiStore'

/**
 * Auto AI drop-launch policy. Kept pure so the "does this drop fire an agent?"
 * decision is unit-testable — a false positive here spawns a real agent
 * against a real repo, so every guard is explicit.
 */

export interface AutoRunCandidate {
  /** Card metadata as stored on the board task. */
  metadata?: Record<string, unknown> | undefined
  /** Column the card sat in before this drag (null when unknown). */
  fromColumnId: string | null | undefined
  /** Column the card was dropped into. */
  toColumnId: string | null | undefined
}

export function readHangarMission(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const hangar = metadata?.hangar
  if (!hangar || typeof hangar !== 'object' || Array.isArray(hangar)) return null
  return hangar as Record<string, unknown>
}

/** True when a card carries a complete, launchable mission payload. */
export function isLaunchableMission(metadata: Record<string, unknown> | undefined): boolean {
  const hangar = readHangarMission(metadata)
  if (!hangar) return false
  return (
    typeof hangar.repo === 'string' && hangar.repo.trim().length > 0 &&
    typeof hangar.instruction === 'string' && hangar.instruction.trim().length > 0 &&
    typeof hangar.objective === 'string' && hangar.objective.length > 0
  )
}

/**
 * A drop fires a mission only when every condition holds:
 * board Auto AI on · a trigger column is configured · the card landed IN it
 * from somewhere else · the card is a complete mission · its own auto-run
 * switch is armed. Re-ordering inside the trigger column never re-fires.
 */
export function shouldAutoRunOnDrop(config: HangarBoardConfig, candidate: AutoRunCandidate): boolean {
  if (!config.enabled || !config.triggerColumnId) return false
  const { fromColumnId, toColumnId, metadata } = candidate
  if (!toColumnId || toColumnId !== config.triggerColumnId) return false
  // Unknown provenance fails CLOSED. A missing origin means we cannot prove
  // the card actually crossed into the launch column, and the cost of a wrong
  // "yes" is a real agent on a real repo — the operator can always launch by
  // hand, so refusing is the cheap side of the error.
  if (!fromColumnId || fromColumnId === toColumnId) return false
  if (!isLaunchableMission(metadata)) return false
  return readHangarMission(metadata)?.autoRun === true
}

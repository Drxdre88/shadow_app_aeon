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

export type MissionResultStatus = 'completed' | 'needs_input' | 'failed'

export interface MissionResultView {
  status: MissionResultStatus | null
  outcome: string | null
  summary: string | null
  branch: string | null
  commit: string | null
  artifacts: string[]
  tests: { status: 'passed' | 'failed' | 'not_run'; summary: string | null } | null
  questions: string[]
  recommendedTasks: Array<{ title: string; objective: string | null; instruction: string | null }>
}

export interface MissionCardView {
  objective: string | null
  repo: string | null
  agent: string | null
  model: string | null
  instruction: string | null
  autoRun: boolean
  sessionIds: string[]
  lastResult: MissionResultView | null
}

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(stringValue).filter((item): item is string => item !== null) : []

export function readHangarMission(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const hangar = metadata?.hangar
  if (!hangar || typeof hangar !== 'object' || Array.isArray(hangar)) return null
  return hangar as Record<string, unknown>
}

export function readMissionResult(value: unknown): MissionResultView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  const status = result.status === 'completed' || result.status === 'needs_input' || result.status === 'failed'
    ? result.status
    : null
  const testsValue = result.tests
  let tests: MissionResultView['tests'] = null
  if (testsValue && typeof testsValue === 'object' && !Array.isArray(testsValue)) {
    const raw = testsValue as Record<string, unknown>
    if (raw.status === 'passed' || raw.status === 'failed' || raw.status === 'not_run') {
      tests = { status: raw.status, summary: stringValue(raw.summary) }
    }
  }
  const recommendedTasks = Array.isArray(result.recommended_tasks)
    ? result.recommended_tasks.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const raw = item as Record<string, unknown>
        const title = stringValue(raw.title)
        return title ? [{ title, objective: stringValue(raw.objective), instruction: stringValue(raw.instruction) }] : []
      })
    : []

  return {
    status,
    outcome: stringValue(result.outcome),
    summary: stringValue(result.summary),
    branch: stringValue(result.branch),
    commit: stringValue(result.commit),
    artifacts: stringList(result.artifacts),
    tests,
    questions: stringList(result.questions),
    recommendedTasks,
  }
}

export function readMissionCard(metadata: Record<string, unknown> | undefined): MissionCardView | null {
  const hangar = readHangarMission(metadata)
  if (!hangar) return null
  return {
    objective: stringValue(hangar.objective),
    repo: stringValue(hangar.repo),
    agent: stringValue(hangar.agent),
    model: stringValue(hangar.model),
    instruction: stringValue(hangar.instruction),
    autoRun: hangar.autoRun === true,
    sessionIds: stringList(hangar.sessionIds),
    lastResult: readMissionResult(hangar.lastResult),
  }
}

export function withRecordedMissionLaunch(
  metadata: Record<string, unknown> | undefined,
  sessionId: string,
  launchedAt: string,
): Record<string, unknown> {
  const mission = readHangarMission(metadata) ?? {}
  const sessionIds = stringList(mission.sessionIds)
  return {
    ...metadata,
    hangar: {
      ...mission,
      autoRun: false,
      lastLaunchedAt: launchedAt,
      sessionIds: sessionIds.includes(sessionId) ? sessionIds : [...sessionIds, sessionId],
    },
  }
}

export function withConfirmedMissionLaunch<T extends { id: string; metadata?: Record<string, unknown> }>(
  tasks: T[],
  taskId: string,
  sessionId: string,
  launchedAt: string,
): T[] {
  return tasks.map((task) => task.id === taskId
    ? { ...task, metadata: withRecordedMissionLaunch(task.metadata, sessionId, launchedAt) }
    : task)
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

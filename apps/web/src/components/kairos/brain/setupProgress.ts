import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'

export type Tick = 'done' | 'todo' | 'unknown'
export type SessionTool = 'claude' | 'codex' | 'copilot'

export interface SetupProgress {
  connect: Tick
  brain: Tick
  brainRanBefore: boolean
  requiredDone: number
  requiredTotal: number
  allRequiredDone: boolean
  showRetired: boolean
  watched: Tick
  voice: Tick
  sessions: Tick
  sessionTools: Record<SessionTool, Tick>
  chat: Tick
  telegram: Tick
  optionalDone: number
  optionalTotal: number
}

const tick = (known: boolean, done: boolean): Tick => (!known ? 'unknown' : done ? 'done' : 'todo')

export function setupProgress(status: KairosBrainStatus): SetupProgress {
  const { setup, isAdmin } = status
  const brainRoutine = status.routines.find((r) => r.id === 'brain')
  const chatRoutine = status.routines.find((r) => r.id === 'chat')
  const brain: Tick = brainRoutine?.state === 'live' ? 'done' : 'todo'
  const connect: Tick = brain === 'done' ? 'done' : tick(!!setup, !!setup?.connectorUsedAt)

  const sessionTools: Record<SessionTool, Tick> = {
    claude: tick(!!setup, !!setup?.sessions.claude),
    codex: tick(!!setup, !!setup?.sessions.codex),
    copilot: tick(!!setup, !!setup?.sessions.copilot),
  }
  const anySession = Object.values(sessionTools).includes('done')
  const optional: Tick[] = [
    tick(!!setup, (setup?.watchedBoards ?? 0) > 0),
    tick(!!setup, !!setup?.voiceNoteAt),
    tick(!!setup, anySession),
  ]
  const chat: Tick = chatRoutine?.state === 'live' || (status.telegram.routineFlagOn && status.telegram.routineConfigured)
    ? 'done'
    : 'todo'
  const telegram = tick(!!setup, !!setup?.telegramConfigured)
  if (isAdmin) optional.push(chat, telegram)

  const required = [connect, brain]
  const requiredDone = required.filter((t) => t === 'done').length
  return {
    connect,
    brain,
    brainRanBefore: !!brainRoutine?.lastClaimAt,
    requiredDone,
    requiredTotal: required.length,
    allRequiredDone: requiredDone === required.length,
    showRetired: isAdmin || status.routines.some((r) => r.state === 'silent' && !!r.lastClaimAt),
    watched: optional[0],
    voice: optional[1],
    sessions: optional[2],
    sessionTools,
    chat,
    telegram,
    optionalDone: optional.filter((t) => t === 'done').length,
    optionalTotal: optional.length,
  }
}

export function requiredMissing(status: KairosBrainStatus): number {
  const p = setupProgress(status)
  return p.requiredTotal - p.requiredDone
}

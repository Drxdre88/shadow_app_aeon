import type { ThinkingJobKind } from '@/lib/kairos/engine/types'
import type { RoutineId } from './catalog'

// Contract between the brain-status server action and the Connect Kairos modal.

export type AnsweredBy = 'routine' | 'backup' | 'missed'

export interface BrainKindStatus {
  kind: ThinkingJobKind
  lastAt: string | null
  lastAnsweredBy: AnsweredBy | null
  // Counts over the last 7 days.
  week: Record<AnsweredBy, number>
}

export interface BrainRoutineStatus {
  id: RoutineId
  lastClaimAt: string | null
  // 'live' = claimed within its expected window; 'silent' = scheduled but no
  // claim in the last 26 h; 'off' = not set up / flag off.
  state: 'live' | 'silent' | 'off'
}

export interface KairosPaidBackupStatus {
  // The user's "Paid backup" switch (default on).
  enabled: boolean
  // Jobs answered by the backup in the last 7 days — a spend proxy.
  paidCallsLast7d: number
}

export interface KairosBrainStatus {
  generatedAt: string
  appUrl: string
  mcpUrl: string
  // Last night (since 00:00 UTC yesterday): how jobs were answered.
  lastNight: Record<AnsweredBy, number>
  // Kinds answered by the backup (paid key / cron) in the last 24 h.
  backupKinds: ThinkingJobKind[]
  kinds: BrainKindStatus[]
  routines: BrainRoutineStatus[]
  telegram: { routineFlagOn: boolean; routineConfigured: boolean }
  isAdmin: boolean
  // Always set by getKairosBrainStatus; optional so older fixtures/clients
  // without it still type-check (the UI hides the switch when absent).
  paidBackup?: KairosPaidBackupStatus
  // Live ✓ signals for the Set up Kairos checklist (optional for old fixtures).
  setup?: KairosSetupSignals
  // Chat routine reply times over the last 7 days; null/absent = no turns.
  chatLatency?: KairosChatLatency | null
}

// Chat turns (web + Telegram) in a window, by who answered.
export interface KairosChatLatency {
  turns: number
  routine: number
  backup: number
  missed: number
  // Routine-answered turns, queued → answered.
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  // Backup turns, queued → settled (from the stamped timing).
  backupP50Ms: number | null
  // The latest turn's reply time, when known.
  lastTurnMs: number | null
  // Turns whose routine fire failed.
  fireFailures: number
}

export interface KairosSetupSignals {
  // An OAuth (claude.ai connector) token for this user was used in the last 7 days.
  connectorUsedAt: string | null
  // Latest captured coding session per tool.
  sessions: { claude: string | null; codex: string | null; copilot: string | null }
  // Any voice note ever staged via kairos_voice_note.
  voiceNoteAt: string | null
  // Number of boards with a Kairos watch setting.
  watchedBoards: number
  // Telegram bot configured (token + operator chat id) — owner only.
  telegramConfigured: boolean
}

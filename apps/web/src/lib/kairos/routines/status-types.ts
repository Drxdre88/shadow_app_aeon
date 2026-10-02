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
}

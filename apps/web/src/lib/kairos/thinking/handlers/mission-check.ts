import type { ApplyOutcome, ThinkingJobHandler, ThinkingJobSpec } from '@/lib/kairos/engine/types'

// Mission check (Workforce, deep tier, brain routine) — inert stub until the
// Workforce lane builds it: plans nothing, applies nothing, no fallback.
export const missionCheckHandler: ThinkingJobHandler = {
  kind: 'mission_check',
  plan: async (): Promise<ThinkingJobSpec[]> => [],
  apply: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'mission_check is not implemented yet' }),
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — the verdict is skipped' }),
}

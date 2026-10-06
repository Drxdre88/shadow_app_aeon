import type { ApplyOutcome, ThinkingJobHandler, ThinkingJobSpec } from '@/lib/kairos/engine/types'

// Repo lessons (Workforce, deep tier, brain routine) — inert stub until the
// Workforce lane builds it: plans nothing, applies nothing, no fallback.
export const repoLessonsHandler: ThinkingJobHandler = {
  kind: 'repo_lessons',
  plan: async (): Promise<ThinkingJobSpec[]> => [],
  apply: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'repo_lessons is not implemented yet' }),
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — the lessons note waits for the next night' }),
}

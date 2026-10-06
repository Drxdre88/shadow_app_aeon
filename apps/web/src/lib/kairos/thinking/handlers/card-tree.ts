import type { ApplyOutcome, ThinkingJobHandler, ThinkingJobSpec } from '@/lib/kairos/engine/types'

// Card tree (Workforce, deep tier, brain routine, on request only) — inert
// stub until the Workforce lane builds it: plans nothing, applies nothing, no fallback.
export const cardTreeHandler: ThinkingJobHandler = {
  kind: 'card_tree',
  plan: async (): Promise<ThinkingJobSpec[]> => [],
  apply: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'card_tree is not implemented yet' }),
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — no draft is made' }),
}

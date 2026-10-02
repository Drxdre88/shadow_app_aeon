import { GOAL_MEMORY_TYPE, GOAL_PROPOSAL_KIND } from './parse'

// Goals are owner-decided (Phase 2): agent surfaces (MCP, REST bearer) may
// never approve, veto, archive, retype, rewrite or delete a goal row — a
// pending proposal or an approved goal. The signed-in session is not gated
// here; decisions go through the goal transitions.
export const OPERATOR_ONLY_GOAL_ERROR =
  'Kairos goals can only be approved, vetoed, closed, edited or deleted by the operator in Aeon or Telegram'

export function isGoalRow(row: { type?: unknown; sourceMetadata?: unknown } | null | undefined): boolean {
  if (!row) return false
  if (row.type === GOAL_MEMORY_TYPE) return true
  const meta = row.sourceMetadata
  return !!meta && typeof meta === 'object' && (meta as Record<string, unknown>).kind === GOAL_PROPOSAL_KIND
}

export interface GoalPatch {
  archivedAt?: string | Date | null
  type?: string
  title?: string
  bodyMd?: string
  summary?: string | null
}

type GoalPatchRow = {
  type?: unknown
  sourceMetadata?: unknown
  title?: unknown
  bodyMd?: unknown
  summary?: unknown
}

// Refusal message when an agent-surface patch would archive/unarchive (a
// veto by another name), retype or rewrite a goal row; null when allowed.
// Summary backfills (aiTitle / execSummary), tags and pinned stay allowed.
export function goalPatchRefusal(row: GoalPatchRow | null | undefined, patch: GoalPatch): string | null {
  if (!row || !isGoalRow(row)) return null
  const changes = (field: 'type' | 'title' | 'bodyMd' | 'summary') =>
    patch[field] !== undefined && patch[field] !== row[field]
  if (patch.archivedAt !== undefined) return OPERATOR_ONLY_GOAL_ERROR
  if (changes('type') || changes('title') || changes('bodyMd') || changes('summary')) return OPERATOR_ONLY_GOAL_ERROR
  return null
}

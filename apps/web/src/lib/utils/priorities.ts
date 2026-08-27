import { INITIAL_PRIORITIES, type CustomPriority } from '@aeon/shared'
import { hexToRgba } from '@/lib/utils/colors'

export interface ResolvedPriority {
  id: string
  name: string
  color: string
}

/**
 * Single source of truth for priority appearance.
 *
 * `priorities` is the user's customized set from themeStore (hydrated from
 * user preferences — custom names, colors, emojis, extra levels). Factory
 * INITIAL_PRIORITIES are only a last-resort fallback for ids missing from the
 * customized list (e.g. a removed core level still referenced by an old task).
 * Never render from hardcoded per-priority constants — resolve through here.
 */
export function resolvePriority(priorities: CustomPriority[], priorityId: string): ResolvedPriority {
  const custom = priorities.find((p) => p.id === priorityId)
  if (custom) return custom
  const factory = INITIAL_PRIORITIES.find((p) => p.id === priorityId)
  if (factory) return factory
  return { id: priorityId, name: priorityId, color: '#94a3b8' }
}

/** Translucent badge style (chips, peek previews) derived from a priority color. */
export function priorityBadgeStyle(color: string): { backgroundColor: string; color: string } {
  return { backgroundColor: hexToRgba(color, 0.15), color }
}

/** Selected/active chip style for priority pickers and filter chips. */
export function priorityActiveStyle(color: string): {
  backgroundColor: string
  borderColor: string
  color: string
  boxShadow: string
} {
  return {
    backgroundColor: hexToRgba(color, 0.25),
    borderColor: hexToRgba(color, 0.5),
    color,
    boxShadow: `0 0 10px ${hexToRgba(color, 0.35)}`,
  }
}

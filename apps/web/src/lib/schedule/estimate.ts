/**
 * The single size-to-duration conversion in Chronos (CHR-13). The solver never reads
 * `size` directly — it calls this, so a points board and a days board can no longer
 * schedule the same number as the same span.
 */
import type { EstimateResolver } from './types'

const MINUTES_PER_HOUR = 60

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Whole minutes, never zero — an estimate that rounds away is still an estimate, not absence. */
function wholeMinutes(value: number): number {
  return Math.max(1, Math.round(value))
}

/** Explicit minutes win; otherwise convert `size` through the board's unit. */
export const resolveEstimateMinutes: EstimateResolver = (task, sizing, calendar) => {
  const explicit = positiveOrNull(task?.estimateMinutes)
  if (explicit !== null) return wholeMinutes(explicit)

  const size = positiveOrNull(task?.size)
  if (size === null) return null

  const hoursPerUnit =
    sizing?.unit === 'points'
      ? positiveOrNull(sizing?.hoursPerPoint)
      : positiveOrNull(calendar?.hoursPerDay)
  if (hoursPerUnit === null) return null

  return wholeMinutes(size * hoursPerUnit * MINUTES_PER_HOUR)
}

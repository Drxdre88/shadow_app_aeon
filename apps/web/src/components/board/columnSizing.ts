/**
 * Column sizing model (Trello content-fit + viewport cap).
 *
 * The persisted height preference keeps its legacy 200-1600 storage range
 * (server validators and old clients still enforce it), but it is READ as
 * thousandths of the available viewport height, clamped to full height at
 * 1000. The settings UI presents it as a percentage of the screen.
 */

/** Stored preference value that means "full available height". */
export const FULL_HEIGHT_PREF = 1000

/**
 * Stored preference → CSS cap multiplier for --col-h-scale.
 * Non-finite / missing values (old hydration paths never type-checked the
 * preference) fall back to full height rather than emitting "NaN", which
 * would invalidate the max-height declaration and uncap every column.
 */
export function columnHeightScale(pref: unknown): number {
  if (typeof pref !== 'number' || !Number.isFinite(pref)) return 1
  return Math.min(1, Math.max(0.2, pref / FULL_HEIGHT_PREF))
}

/** Manual per-column drag resize works in real pixels of the dragged box. */
export function clampManualColumnHeight(px: number): number {
  return Math.max(200, Math.min(1600, px))
}

/** Stored preference → settings-slider percentage (20-100). */
export function heightPrefToPercent(pref: number): number {
  const finite = Number.isFinite(pref) ? pref : FULL_HEIGHT_PREF
  return Math.round(Math.min(FULL_HEIGHT_PREF, Math.max(200, finite)) / 10)
}

/** Settings-slider percentage → stored preference (200-1000). */
export function percentToHeightPref(percent: number): number {
  return Math.round(Math.min(100, Math.max(20, percent)) * 10)
}

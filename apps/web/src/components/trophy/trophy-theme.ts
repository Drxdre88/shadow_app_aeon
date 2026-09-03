/**
 * Trophy Vault warm identity palette.
 *
 * The vault's signature is gold/amber — celebratory, never blue. Everything
 * else (surfaces, borders, text) comes from the active theme's tokens so the
 * surface stays legible across all presets, light and dark. Priority colors
 * are NOT defined here — resolve them through `@/lib/utils/priorities`.
 */

export const GOLD = {
  /** Core gold accent (amber-500). */
  base: '#f59e0b',
  /** Bright gold for dark surfaces (amber-400). */
  bright: '#fbbf24',
  /** Deep gold for light surfaces (amber-700). */
  deep: '#b45309',
  /** Glow color for medallion / accent shadows. */
  glow: 'rgba(245,158,11,0.45)',
} as const

/** Gold text tuned for contrast on the current theme. */
export function goldText(isDark: boolean): string {
  return isDark ? GOLD.bright : GOLD.deep
}

/**
 * `#rrggbb` -> `rgba()` with alpha.
 *
 * Not a second implementation: this is the canonical `hexToRgba`, re-exported
 * under the name the vault's call sites already read by. Folding the vault's
 * old hand-rolled copy into it also picked up its NaN / short-hex guard, so a
 * malformed color now degrades to slate instead of emitting `rgba(NaN,…)`,
 * which the browser drops entirely.
 */
export { hexToRgba as hexAlpha } from '@/lib/utils/colors'

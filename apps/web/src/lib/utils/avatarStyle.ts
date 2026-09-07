import type { CSSProperties } from 'react'
import { resolveAccentHex } from './colors'

/**
 * One place that turns a member's styling overrides into what an avatar
 * actually renders — every avatar surface (card pile, card editor pills, the
 * assign picker, the filter bar) goes through here so a realm's choices look
 * identical everywhere.
 *
 * Every field is nullable and null means "derive": fill from the seed's hue,
 * white text, a circle. So a member with no row renders byte-identically to
 * the pre-override avatar.
 */
export const AVATAR_SHAPES = ['circle', 'rounded', 'square'] as const
export type AvatarShape = (typeof AVATAR_SHAPES)[number]

export type AvatarStyleOverrides = {
  initials?: string | null
  color?: string | null
  textColor?: string | null
  shape?: string | null
}

/**
 * Whether the realm styled this person at all. A styled person shows their
 * styling INSTEAD of their profile photo: an owner who typed initials and picked
 * a fill wants to see them, and a photo that hides them made the whole feature
 * look broken. Unstyled people keep their photo.
 */
export function hasAvatarOverride(m: AvatarStyleOverrides | null | undefined): boolean {
  if (!m) return false
  return Boolean((m.initials ?? '').trim() || m.color || m.textColor || m.shape)
}

export function normaliseShape(shape: string | null | undefined): AvatarShape {
  return (AVATAR_SHAPES as readonly string[]).includes(shape ?? '') ? (shape as AvatarShape) : 'circle'
}

export function avatarShapeClass(shape: string | null | undefined): string {
  switch (normaliseShape(shape)) {
    case 'square': return 'rounded-none'
    case 'rounded': return 'rounded-[28%]'
    default: return 'rounded-full'
  }
}

/** Fill: the override's hex as a soft gradient, else a hue derived from the seed. */
export function avatarBackground(color: string | null | undefined, seed: string): string {
  if (color) {
    const hex = resolveAccentHex(color)
    return `linear-gradient(135deg, ${hex}cc, ${hex}66)`
  }
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return `linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 55% 35%))`
}

/**
 * The inline style + radius class for an initials avatar. `dim` is the
 * pre-override look for an unstyled real member in the card pile — flat and
 * translucent — kept so untouched boards do not change.
 */
export function memberAvatarStyle(
  m: AvatarStyleOverrides & { seed: string },
  opts: { dim?: boolean } = {},
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {}
  if (m.color || !opts.dim) style.background = avatarBackground(m.color, m.seed)
  else style.background = 'rgba(255,255,255,0.08)'
  if (m.textColor) style.color = resolveAccentHex(m.textColor)
  return { className: avatarShapeClass(m.shape), style }
}

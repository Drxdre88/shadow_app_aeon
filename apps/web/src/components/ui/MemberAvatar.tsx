'use client'

import { resolveAccentHex } from '@/lib/utils/colors'
import { getInitials, getInitialsFromEmail } from '@/lib/utils/initials'

/** A realm member without an Aeon account — dashed ring marks them virtual. */
export function VirtualAvatar({ name, initials, color, size = 'md' }: { name: string; initials: string; color: string; size?: 'sm' | 'md' }) {
  const hex = resolveAccentHex(color)
  const cls = size === 'md' ? 'w-7 h-7 text-[10px]' : 'w-5 h-5 text-[8px]'
  return (
    <span
      className={`${cls} rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-white border border-dashed border-white/45`}
      style={{ background: `linear-gradient(135deg, ${hex}cc, ${hex}66)` }}
      title={`${name} (virtual)`}
    >
      {initials}
    </span>
  )
}

/**
 * A real member: their picture, else initials on a hue derived from the seed.
 *
 * `initials` and `color` are the realm's overrides — null means "derive", so a
 * member without either renders exactly as they did before overrides existed.
 * `preferInitials` suppresses the picture, which is the only way an override
 * becomes visible on an account that has one.
 */
export function MemberAvatar({ member, preferInitials }: {
  member: { name: string | null; email: string; image: string | null; initials?: string | null; color?: string | null }
  preferInitials?: boolean
}) {
  if (member.image && !preferInitials) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover border border-white/[0.08]" />
  }
  const seed = (member.name ?? member.email).trim()
  const initials = (member.initials ?? '').trim() || getInitials(seed, '') || getInitialsFromEmail(member.email) || '?'
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  const hex = member.color ? resolveAccentHex(member.color) : null
  return (
    <span
      className="w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center text-[10px] font-semibold text-white border border-white/[0.08]"
      style={{
        background: hex
          ? `linear-gradient(135deg, ${hex}cc, ${hex}66)`
          : `linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 55% 35%))`,
      }}
      title={member.name ?? member.email}
    >
      {initials}
    </span>
  )
}

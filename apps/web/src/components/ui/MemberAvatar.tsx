'use client'

import { getInitials, getInitialsFromEmail } from '@/lib/utils/initials'
import { avatarBackground, hasAvatarOverride, memberAvatarStyle } from '@/lib/utils/avatarStyle'

/** A realm member without an Aeon account — dashed ring marks them virtual. */
export function VirtualAvatar({ name, initials, color, size = 'md' }: { name: string; initials: string; color: string; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'w-7 h-7 text-[10px]' : 'w-5 h-5 text-[8px]'
  return (
    <span
      className={`${cls} rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-white border border-dashed border-white/45`}
      style={{ background: avatarBackground(color, name) }}
      title={`${name} (virtual)`}
    >
      {initials}
    </span>
  )
}

export type MemberAvatarMember = {
  name: string | null
  email: string
  image: string | null
  /** Realm overrides — null means "derive", exactly as before overrides existed. */
  initials?: string | null
  color?: string | null
  textColor?: string | null
  shape?: string | null
}

/**
 * A real member. Their picture when they have one and nobody styled them;
 * otherwise initials on a fill.
 *
 * Styling beats the photo on purpose: an owner who typed initials and picked a
 * colour wants to see them, and hiding them behind an OAuth avatar made the
 * whole feature look broken. `preferInitials` (board or realm policy) hides
 * photos for everyone, styled or not.
 */
export function MemberAvatar({ member, preferInitials }: {
  member: MemberAvatarMember
  preferInitials?: boolean
}) {
  if (member.image && !preferInitials && !hasAvatarOverride(member)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover border border-white/[0.08]" />
  }
  const seed = (member.name ?? member.email).trim()
  const initials = (member.initials ?? '').trim() || getInitials(seed, '') || getInitialsFromEmail(member.email) || '?'
  const { className, style } = memberAvatarStyle({ ...member, seed })
  return (
    <span
      className={`w-7 h-7 shrink-0 inline-flex items-center justify-center text-[10px] font-semibold text-white border border-white/[0.08] ${className}`}
      style={style}
      title={member.name ?? member.email}
    >
      {initials}
    </span>
  )
}

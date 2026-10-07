'use client'

import { resolveAccentHex } from '@/lib/utils/colors'
import { getInitials, getInitialsFromEmail } from '@/lib/utils/initials'
import { hasAvatarOverride, memberAvatarStyle } from '@/lib/utils/avatarStyle'
import type { TaskAssigneePill } from '@/lib/store/boardStore'

// The card's assignee pile: up to four dots, then a "+N" overflow chip.
export function TaskCardAssignees({ assignees, preferInitials }: { assignees: TaskAssigneePill[]; preferInitials?: boolean }) {
  return (
    <div className="flex items-center -space-x-1.5 flex-shrink-0 ml-1 self-start pt-0.5">
      {assignees.slice(0, 4).map((a) => (
        <AssigneeDot key={a.userId} name={a.name} email={a.email} initials={a.initials} image={a.image} kind={a.kind} color={a.color} textColor={a.textColor} shape={a.shape} preferInitials={preferInitials} />
      ))}
      {assignees.length > 4 && (
        <span className="w-5 h-5 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[8px] text-white/60">
          +{assignees.length - 4}
        </span>
      )}
    </div>
  )
}

function AssigneeDot({ name, email, initials: stored, image, kind, color, textColor, shape, preferInitials }: { name: string | null; email?: string | null; initials?: string | null; image: string | null; kind?: 'virtual'; color?: string | null; textColor?: string | null; shape?: string | null; preferInitials?: boolean }) {
  // A profile picture wins only for an UNSTYLED member. Styling (initials,
  // fill, text colour, shape) replaces it — a curated override hidden behind
  // an OAuth avatar looked like the feature did nothing. `preferInitials`
  // (board or realm policy) hides photos for everyone.
  const styled = kind !== 'virtual' && hasAvatarOverride({ initials: stored, color, textColor, shape })
  if (image && !preferInitials && !styled) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className="w-5 h-5 rounded-full object-cover border border-white/15" title={name ?? undefined} />
  }
  // Stored initials win — a virtual member named "MG" chose those two letters,
  // and recomputing from the name would render "M". Then the name, then the
  // email, and only then the '?' that means "we know nothing about this person".
  const initials = (stored ?? '').trim() || getInitials(name, '') || getInitialsFromEmail(email) || '?'
  // Virtual members: colored initials avatar with a dashed ring — subtly
  // distinct from real accounts in the pile.
  if (kind === 'virtual') {
    const hex = resolveAccentHex(color)
    return (
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold border border-dashed border-white/45 text-white"
        style={{ background: `linear-gradient(135deg, ${hex}cc, ${hex}66)` }}
        title={name ? `${name} (virtual)` : undefined}
      >
        {initials || '?'}
      </span>
    )
  }
  // A real member: the realm's styling, or the flat translucent dot they
  // always had. No dashed ring — that stays the "no account" marker.
  const av = memberAvatarStyle({ seed: name ?? email ?? '', color, textColor, shape }, { dim: true })
  return (
    <span
      className={`w-5 h-5 flex items-center justify-center text-[8px] font-medium border border-white/15 ${styled ? 'text-white' : 'text-white/80'} ${av.className}`}
      style={av.style}
      title={name ?? undefined}
    >
      {initials || '?'}
    </span>
  )
}

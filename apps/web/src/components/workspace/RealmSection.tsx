'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface RealmSectionProps {
  realm: {
    id: string
    name: string
    color: string
    isPersonal: boolean
    isOwner: boolean
    memberCount: number
    memberAvatars?: Array<{ name?: string; image?: string }>
    projectCount: number
  }
  defaultExpanded?: boolean
  onOpenSettings: ((realm: { id: string; name: string; isOwner: boolean; isPersonal: boolean }) => void) | null
  children: React.ReactNode
}

function getInitials(name?: string): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function stringToHue(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash) % 360
}

function AvatarStack({ avatars, memberCount }: { avatars: Array<{ name?: string; image?: string }>; memberCount: number }) {
  const shown = avatars.slice(0, 3)
  const overflow = memberCount - shown.length

  return (
    <div className="flex items-center">
      {shown.map((avatar, i) => {
        const hue = stringToHue(avatar.name ?? String(i))
        return (
          <div
            key={i}
            className="w-6 h-6 rounded-full border border-black/40 flex items-center justify-center text-[9px] font-semibold text-white overflow-hidden"
            style={{
              marginLeft: i === 0 ? 0 : -8,
              zIndex: shown.length - i,
              background: avatar.image ? undefined : `hsl(${hue}, 55%, 40%)`,
            }}
          >
            {avatar.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar.image} alt={avatar.name ?? ''} className="w-full h-full object-cover" />
            ) : (
              getInitials(avatar.name)
            )}
          </div>
        )
      })}
      {overflow > 0 && (
        <div
          className="w-6 h-6 rounded-full border border-black/40 flex items-center justify-center text-[9px] font-semibold text-white/60 bg-white/10"
          style={{ marginLeft: -8, zIndex: 0 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}

export function RealmSection({ realm, defaultExpanded = true, onOpenSettings, children }: RealmSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const accentColor = realm.color.startsWith('#') ? realm.color : 'var(--primary)'

  return (
    <div className="mb-2">
      <div
        className="relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer select-none"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          boxShadow: `0 2px 12px 0 ${accentColor}18`,
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {onOpenSettings && (
          <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200',
                'border bg-transparent'
              )}
              style={{
                borderColor: `${accentColor}55`,
                color: accentColor,
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget
                el.style.boxShadow = `0 0 8px 2px ${accentColor}40`
                el.style.borderColor = accentColor
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget
                el.style.boxShadow = 'none'
                el.style.borderColor = `${accentColor}55`
              }}
              onClick={() => onOpenSettings({ id: realm.id, name: realm.name, isOwner: realm.isOwner, isPersonal: realm.isPersonal })}
            >
              <Settings size={15} />
            </button>
          </div>
        )}

        <div
          className="w-[3px] self-stretch rounded-full shrink-0"
          style={{ background: accentColor }}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{realm.name}</p>
          <p className="text-xs text-white/40 mt-0.5">
            {realm.projectCount} project{realm.projectCount !== 1 ? 's' : ''} · {realm.memberCount} member{realm.memberCount !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(realm.memberAvatars?.length ?? 0) > 0 && (
            <AvatarStack
              avatars={realm.memberAvatars!}
              memberCount={realm.memberCount}
            />
          )}

          <ChevronDown
            size={14}
            className="text-white/40 shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="realm-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

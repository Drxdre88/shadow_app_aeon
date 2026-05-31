'use client'

import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut, User, Eye, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSidebarStore } from '@/stores/sidebarStore'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import { ChangelogButton } from '@/components/ui/ChangelogModal'
import { AdvisoryFeed } from '@/components/kairos/AdvisoryFeed'
import { LiveSessionsButton } from '@/components/kairos/LiveSessionsButton'
import { DailyBriefingButton } from '@/components/hyperspace/DailyBriefingButton'
import { EodReflectionButton } from '@/components/hyperspace/EodReflectionButton'

type SidebarUser = { name?: string | null; email?: string | null; image?: string | null; role: string }

export function SidebarBottom({
  user, collapsed, onSignOut,
}: {
  user: SidebarUser
  collapsed: boolean
  onSignOut: () => void
}) {
  return (
    <div className="shrink-0">
      <div className="mx-2 h-px bg-white/[0.06]" />
      {collapsed ? (
        <div className="flex flex-col items-center justify-center gap-1 px-2 py-2" style={{ color: 'var(--primary)' }}>
          <NotesButton />
          <DailyBriefingButton />
          <AdvisoryFeed />
          <EodReflectionButton />
          <LiveSessionsButton />
          <ChangelogButton />
          <BetaFeaturesButton />
          <HelpButton />
          <StatsButton />
          <SettingsButton />
          <UnhideButton />
        </div>
      ) : (
        <div className="px-2 py-2" style={{ color: 'var(--primary)' }}>
          <div className="flex items-center justify-center gap-1">
            <NotesButton />
            <DailyBriefingButton />
            <AdvisoryFeed />
            <EodReflectionButton />
            <LiveSessionsButton />
          </div>
          <div
            className="my-1.5 h-px mx-6"
            style={{
              background:
                'linear-gradient(to right, transparent, color-mix(in oklab, var(--primary) 55%, transparent), transparent)',
              boxShadow: '0 0 6px color-mix(in oklab, var(--primary) 40%, transparent)',
            }}
          />
          <div className="flex items-center justify-center gap-1">
            <ChangelogButton />
            <BetaFeaturesButton />
            <HelpButton />
            <StatsButton />
            <SettingsButton />
            <UnhideButton />
          </div>
        </div>
      )}
      <div className="mx-2 h-px bg-white/[0.06]" />
      <div className={cn('flex items-center gap-2.5 px-2 py-3', collapsed && 'flex-col gap-1.5 py-2')}>
        <div className="shrink-0 w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center bg-white/[0.08] border border-white/[0.1]">
          {user.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={user.image} alt={user.name ?? ''} referrerPolicy="no-referrer" className="w-7 h-7 object-cover" />
          ) : (
            <User className="w-3.5 h-3.5 text-white/40" />
          )}
        </div>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 min-w-0 overflow-hidden"
            >
              <p className="text-xs font-medium text-white/70 truncate">
                {user.name ?? user.email ?? 'User'}
              </p>
              <p className="text-[10px] text-white/30 truncate capitalize">{user.role}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onSignOut}
          className="shrink-0 p-1.5 rounded-lg text-white/30 hover:text-red-400/80 hover:bg-red-500/[0.08] transition-all duration-200"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </motion.button>
      </div>
    </div>
  )
}

function NotesButton() {
  return (
    <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
      <Link
        href="/notes"
        title="Notes — your memory bento"
        className="block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <StickyNote className="w-4 h-4" />
      </Link>
    </motion.div>
  )
}

function UnhideButton() {
  const { hiddenProjectIds, hiddenRealmIds, unhideAll } = useSidebarStore()
  const count = hiddenProjectIds.length + hiddenRealmIds.length
  if (count === 0) return null

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={unhideAll}
      className="relative p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      title={`${count} hidden item${count > 1 ? 's' : ''} — click to unhide all`}
    >
      <Eye className="w-4 h-4" />
      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
        {count}
      </span>
    </motion.button>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Sun } from 'lucide-react'
import { AnchoredPopover } from '@/components/ui/AnchoredPopover'
import { DailyBriefingCard } from './DailyBriefingCard'
import { getTodaysBriefings } from '@/lib/actions/memories'

// Notification badge mirrors AdvisoryFeed's pattern: count today's briefings
// the operator hasn't opened yet, persisted as a last-viewed timestamp.
const LAST_VIEWED_KEY = 'kairos.dailyBriefing.lastViewed'
const POLL_INTERVAL_MS = 90_000 // gentle refresh — Briefer fires once at 07:00 UTC

function getLastViewed(): number {
  if (typeof window === 'undefined') return 0
  const raw = localStorage.getItem(LAST_VIEWED_KEY)
  return raw ? Number(raw) || 0 : 0
}

function setLastViewed(t: number): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(LAST_VIEWED_KEY, String(t))
}

export function DailyBriefingButton() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const refreshUnread = useCallback(async () => {
    try {
      const briefings = await getTodaysBriefings()
      const lastViewed = getLastViewed()
      const count = briefings.filter(
        (b) => new Date(b.createdAt).getTime() > lastViewed,
      ).length
      setUnread(count)
    } catch {
      // Non-fatal: silent fallback to zero rather than blocking the icon.
    }
  }, [])

  useEffect(() => {
    refreshUnread()
    const t = setInterval(refreshUnread, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [refreshUnread])

  const handleOpen = () => {
    setOpen((v) => !v)
    if (!open) {
      // Mark today's briefings as seen the moment the modal opens.
      const now = Date.now()
      setLastViewed(now)
      setUnread(0)
    }
  }

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleOpen}
        title={unread > 0 ? `Daily briefing — ${unread} unread` : 'Daily briefing'}
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Sun className="w-4 h-4" />
        {unread > 0 && (
          <>
            <motion.span
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full pointer-events-none"
              style={{ background: 'var(--primary)' }}
              animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.8, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-semibold rounded-full text-white z-[1]"
              style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          </>
        )}
      </motion.button>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        width={920}
        maxHeight="82vh"
        icon={<Sun className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />}
        title={<span className="text-[11px] uppercase tracking-[0.22em] text-white/65">Daily Briefing</span>}
      >
        <div className="p-3">
          <DailyBriefingCard />
        </div>
      </AnchoredPopover>
    </>
  )
}

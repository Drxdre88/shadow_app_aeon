'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Sun } from 'lucide-react'
import { AnchoredPopover } from '@/components/ui/AnchoredPopover'
import { DailyBriefingCard } from './DailyBriefingCard'

export function DailyBriefingButton() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        title="Daily briefing"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Sun className="w-4 h-4" />
      </motion.button>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        width={520}
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

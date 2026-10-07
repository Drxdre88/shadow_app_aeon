'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Archive } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { ArchivedBoardsPanel } from './ArchivedBoardsPanel'
import { useArchivedBoards } from './useArchivedBoards'

/** Sidebar footer entry for archived boards; absent while there are none. */
export function ArchivedBoardsButton() {
  const { boards, status, reload } = useArchivedBoards()
  const [isOpen, setIsOpen] = useState(false)
  const count = boards.length
  if (count === 0 && !isOpen) return null
  const label = `Archived boards (${count})`

  return (
    <>
      <Tooltip label={label} side="top">
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { setIsOpen(true); void reload() }}
          aria-label={label}
          className="relative p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
        >
          <Archive className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-[var(--primary)] text-[8px] font-bold text-white flex items-center justify-center">
            {count}
          </span>
        </motion.button>
      </Tooltip>
      <ArchivedBoardsPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        boards={boards}
        status={status}
        onRetry={() => { void reload() }}
      />
    </>
  )
}

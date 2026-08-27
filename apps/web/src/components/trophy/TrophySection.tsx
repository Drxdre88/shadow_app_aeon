'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { TrophyCard } from './TrophyCard'
import { cn } from '@/lib/utils/cn'
import type { TaskVault } from '@/lib/db/schema'

interface TrophySectionProps {
  label: string
  tasks: TaskVault[]
  onRestore: (vaultId: string) => void
  onCardClick?: (vaultTask: TaskVault) => void
  defaultExpanded?: boolean
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}

export function TrophySection({
  label,
  tasks,
  onRestore,
  onCardClick,
  defaultExpanded = true,
}: TrophySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const colors = useThemeStore((s) => s.colors)

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg',
          'hover:bg-white/[0.04] transition-colors duration-150 group'
        )}
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4" style={{ color: colors.textDim }} />
        </motion.div>
        <span className="text-sm font-medium" style={{ color: colors.textMuted }}>{label}</span>
        <span className="text-xs ml-1 tabular-nums" style={{ color: colors.textDim }}>
          {tasks.length} {tasks.length === 1 ? 'trophy' : 'trophies'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <motion.div
              className="grid grid-cols-2 xl:grid-cols-3 gap-3 pt-2 px-1"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              {tasks.map((vt) => (
                <TrophyCard key={vt.id} vaultTask={vt} onRestore={onRestore} onClick={onCardClick} />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

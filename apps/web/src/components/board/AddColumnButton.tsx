'use client'

import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'

// On a touch device the full-width placeholder is a fourth "column" of
// nothing that the operator drags cards past; a slim rail with the + is
// enough and keeps the last real column reachable in one drag.
export function AddColumnButton({ onClick }: { onClick: () => void }) {
  const coarsePointer = useCoarsePointer()
  return (
    <motion.button
      onClick={onClick}
      data-add-column
      aria-label="Add column"
      title="Add column"
      className={cn(
        'flex-shrink-0 flex flex-col items-center justify-center rounded-xl',
        'border-2 border-dashed border-white/10 hover:border-white/25',
        'text-slate-500 hover:text-slate-300',
        'transition-all duration-200',
        'hover:bg-white/[0.03]',
        coarsePointer ? 'w-12 h-32' : 'min-w-[200px] h-32'
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Plus className={cn('w-6 h-6', !coarsePointer && 'mb-2')} />
      {!coarsePointer && <span className="text-sm font-medium">Add Column</span>}
    </motion.button>
  )
}

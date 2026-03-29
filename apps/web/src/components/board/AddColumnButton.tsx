'use client'

import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function AddColumnButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 flex flex-col items-center justify-center',
        'min-w-[200px] h-32 rounded-xl',
        'border-2 border-dashed border-white/10 hover:border-white/25',
        'text-slate-500 hover:text-slate-300',
        'transition-all duration-200',
        'hover:bg-white/[0.03]'
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Plus className="w-6 h-6 mb-2" />
      <span className="text-sm font-medium">Add Column</span>
    </motion.button>
  )
}

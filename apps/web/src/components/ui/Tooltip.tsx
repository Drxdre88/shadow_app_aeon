'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  delay?: number
}

export function Tooltip({ label, children, side = 'bottom', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            transition={{ duration: 0.15 }}
            className={`absolute left-1/2 -translate-x-1/2 z-50 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-[#1a1a1e] border border-white/10 shadow-lg whitespace-nowrap pointer-events-none ${
              side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
            }`}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

'use client'

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  delay?: number
}

export function Tooltip({ label, children, side = 'bottom', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => { setMounted(true) }, [])

  const measure = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      measure()
      setVisible(true)
    }, delay)
  }, [delay, measure])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  return (
    <div ref={wrapRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {mounted && createPortal(
        <AnimatePresence>
          {visible && rect && (
            <motion.div
              initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                top: side === 'bottom' ? rect.top + rect.height + 8 : rect.top - 8,
                left: rect.left + rect.width / 2,
                transform: side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                zIndex: 9999,
              }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-[#1a1a1e] border border-white/10 shadow-lg whitespace-nowrap pointer-events-none"
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

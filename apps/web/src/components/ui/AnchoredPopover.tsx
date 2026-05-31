'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

type AnchoredPopoverProps = {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  title: ReactNode
  icon?: ReactNode
  width?: number
  maxHeight?: string
  children: ReactNode
}

const VIEWPORT_PAD = 16
const GAP = 8
const HEIGHT_ESTIMATE_FALLBACK = 360

export function AnchoredPopover({
  open, onClose, anchorRef, title, icon, width = 440, maxHeight = '70vh', children,
}: AnchoredPopoverProps) {
  const [mounted, setMounted] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number } | null>(null)
  const [popoverHeight, setPopoverHeight] = useState(HEIGHT_ESTIMATE_FALLBACK)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const measure = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({ top: r.top, bottom: r.bottom, left: r.left })
  }, [anchorRef])

  useEffect(() => {
    if (!open) return
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, measure, onClose])

  // Sync measured popover height into state so the flip decision in the
  // next render doesn't read popoverRef during render.
  useEffect(() => {
    if (!open) return
    const el = popoverRef.current
    if (!el) return
    const measured = el.getBoundingClientRect().height
    if (measured && measured !== popoverHeight) setPopoverHeight(measured)
  }, [open, anchor, popoverHeight])

  if (!mounted) return null

  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 0
  const spaceAbove = anchor ? anchor.top : 0
  const flipBelow = anchor !== null && spaceAbove < popoverHeight + VIEWPORT_PAD
  const resolvedWidth = anchor ? Math.min(width, viewportW - VIEWPORT_PAD * 2) : width
  const clampedLeft = anchor
    ? Math.min(Math.max(VIEWPORT_PAD / 2, anchor.left), viewportW - resolvedWidth - VIEWPORT_PAD / 2)
    : 0

  const positionStyle: React.CSSProperties = anchor
    ? flipBelow
      ? { top: Math.min(anchor.bottom + GAP, viewportH - VIEWPORT_PAD) }
      : { bottom: Math.min(viewportH - anchor.top + GAP, viewportH - VIEWPORT_PAD) }
    : {}

  return createPortal(
    <AnimatePresence>
      {open && anchor && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[170]"
            onClick={onClose}
          />
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: flipBelow ? -8 : 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: flipBelow ? -8 : 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'fixed',
              left: clampedLeft,
              width: resolvedWidth,
              maxHeight,
              zIndex: 171,
              ...positionStyle,
            }}
            className="rounded-2xl bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
          >
            <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2">
                {icon}
                {title}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

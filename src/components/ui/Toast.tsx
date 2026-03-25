'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface ToastItem {
  id: string
  message: string
  onUndo?: () => void
  duration?: number
}

let addToastGlobal: ((toast: Omit<ToastItem, 'id'>) => void) | null = null
let lastUndoRef: { id: string; fn: () => void } | null = null

export function toast(message: string, options?: { onUndo?: () => void; duration?: number }) {
  addToastGlobal?.({ message, ...options })
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => { setMounted(true) }, [])

  const removeToast = useCallback((id: string) => {
    timersRef.current.delete(id)
    if (lastUndoRef?.id === id) lastUndoRef = null
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev, { ...item, id }])
    if (item.onUndo) lastUndoRef = { id, fn: item.onUndo }
    const timer = setTimeout(() => removeToast(id), item.duration || 5000)
    timersRef.current.set(id, timer)
  }, [removeToast])

  useEffect(() => {
    addToastGlobal = addToast
    return () => { addToastGlobal = null; lastUndoRef = null }
  }, [addToast])

  useEffect(() => {
    return () => { timersRef.current.forEach(clearTimeout) }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && lastUndoRef) {
        e.preventDefault()
        const { id, fn } = lastUndoRef
        fn()
        lastUndoRef = null
        removeToast(id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [removeToast])

  if (!mounted) return null

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl',
              'backdrop-blur-xl bg-white/10 border border-white/15',
              'shadow-[0_0_30px_rgba(0,0,0,0.5)]',
              'text-sm text-white'
            )}
          >
            <span>{t.message}</span>
            {t.onUndo && (
              <button
                onClick={() => {
                  t.onUndo?.()
                  removeToast(t.id)
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 transition-colors text-xs font-medium"
              >
                <Undo2 className="w-3 h-3" />
                Undo
              </button>
            )}
            <button
              onClick={() => removeToast(t.id)}
              className="p-1 rounded hover:bg-white/10 text-slate-400 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body
  )
}

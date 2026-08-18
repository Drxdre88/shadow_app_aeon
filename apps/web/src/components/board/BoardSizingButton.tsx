'use client'

import { useEffect, useRef, useState } from 'react'
import { Ruler } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { parseSizing, useBoardSizingStore } from './sizing'
import { BoardSizingModal } from './BoardSizingModal'

interface BoardSizingButtonProps {
  projectId: string
  settings: Record<string, unknown> | null | undefined
}

export function BoardSizingButton({ projectId, settings }: BoardSizingButtonProps) {
  const sizing = useBoardSizingStore((s) => s.sizing)
  const setSizing = useBoardSizingStore((s) => s.setSizing)
  const [isOpen, setIsOpen] = useState(false)

  // Hydrate once per distinct server value: the settings prop is a fresh object
  // on every parent render, and a blind re-hydrate would stomp a just-saved
  // config before the revalidated payload arrives.
  const hydratedRef = useRef<string | null>(null)
  useEffect(() => {
    const key = JSON.stringify((settings as { sizing?: unknown } | null | undefined)?.sizing ?? null)
    if (hydratedRef.current === key) return
    hydratedRef.current = key
    setSizing(parseSizing(settings))
  }, [settings, setSizing])

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        title="Task sizing — map S/M/L/XL to numbers"
        className={cn(
          'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          sizing.enabled ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
        )}
      >
        <Ruler className="w-4 h-4" />
        <span>Sizing</span>
      </button>

      <BoardSizingModal isOpen={isOpen} projectId={projectId} onClose={() => setIsOpen(false)} />
    </>
  )
}

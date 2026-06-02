'use client'

import { Sparkles } from 'lucide-react'
import { useKairosVisorStore } from '@/stores/kairosVisorStore'

// Floating bottom-right button that opens the Kairos chat Visor.
// Stays visible on every workspace view since the Visor is a global
// surface. Hidden when the panel is already open to avoid double-button.
export function KairosVisorToggle() {
  const { isOpen, open } = useKairosVisorStore()
  if (isOpen) return null

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open Kairos chat"
      className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg shadow-purple-900/40 transition hover:scale-105 hover:bg-purple-500 active:scale-95"
    >
      <Sparkles className="h-5 w-5" />
    </button>
  )
}

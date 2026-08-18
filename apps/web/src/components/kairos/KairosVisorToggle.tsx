'use client'

import { useKairosVisorStore } from '@/stores/kairosVisorStore'

// Floating bottom-right launcher for the Kairos AI. Uses the Kairos sigil
// (a cowled shadow figure) as a CSS background — robust for a public asset,
// no next/image config. Global across every workspace view; hidden when the
// chat is already open.
export function KairosVisorToggle() {
  const { isOpen, open } = useKairosVisorStore()
  if (isOpen) return null

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open Kairos AI"
      className="group fixed bottom-5 right-5 z-30 h-14 w-14 overflow-hidden rounded-full border border-white/15 bg-zinc-900 bg-cover bg-center transition hover:scale-105 active:scale-95"
      style={{
        backgroundImage: "url('/kairos_2.png')",
        boxShadow: '0 0 22px color-mix(in srgb, var(--primary) 40%, transparent), 0 6px 18px rgba(0,0,0,0.55)',
      }}
    >
      <span
        className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset"
        style={{ '--tw-ring-color': 'color-mix(in srgb, var(--primary) 30%, transparent)' } as React.CSSProperties}
      />
    </button>
  )
}

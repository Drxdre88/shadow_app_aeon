'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useKairosPrefsStore } from '@/stores/kairosPrefsStore'

// Aether is now a Kairos view, not a standalone route. Anyone landing on
// /aether (old bookmarks, the daily-synthesis link) is sent to /kairos with
// the Aether lens already selected.
export default function AetherRedirect() {
  const router = useRouter()
  const setView = useKairosPrefsStore((s) => s.setView)

  useEffect(() => {
    setView('aether')
    router.replace('/kairos')
  }, [router, setView])

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-[10px] uppercase tracking-[0.3em] text-white/25">Entering Aether…</span>
    </div>
  )
}

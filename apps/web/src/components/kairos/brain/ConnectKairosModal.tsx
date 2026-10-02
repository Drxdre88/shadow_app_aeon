'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Activity, Network, Plug, CalendarClock, Send, CloudOff, RefreshCw, Eye, Mic } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { useThemeStore } from '@/stores/themeStore'
import { getKairosBrainStatus } from '@/lib/actions/kairos-brain'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { KAIROS_VERSION_SHORT } from '@/lib/kairos/version'
import { SegmentedSwitch, tint } from './brainUi'
import { localClock } from './brainTime'
import { StatusView, StatusSkeleton } from './StatusView'
import { BrainMapView } from './BrainMapView'
import { ConnectView } from './ConnectView'
import { RoutinesView } from './RoutinesView'
import { TelegramView } from './TelegramView'
import { WatchedView } from './WatchedView'
import { VoiceNotesView } from './VoiceNotesView'

export type BrainView = 'status' | 'map' | 'connect' | 'watched' | 'voice' | 'routines' | 'telegram'

const VIEWS: { id: BrainView; label: string; icon: typeof Activity }[] = [
  { id: 'status', label: 'Status', icon: Activity },
  { id: 'map', label: 'Brain map', icon: Network },
  { id: 'connect', label: 'Connect', icon: Plug },
  { id: 'watched', label: 'Watched', icon: Eye },
  { id: 'voice', label: 'Voice notes', icon: Mic },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'telegram', label: 'Telegram', icon: Send },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultView?: BrainView
}

export function ConnectKairosModal({ isOpen, onClose, defaultView = 'status' }: Props) {
  const mounted = useHasMounted()
  if (!mounted || !isOpen) return null
  return createPortal(<ModalBody onClose={onClose} defaultView={defaultView} />, document.body)
}

interface Load {
  status: KairosBrainStatus | null
  error: string | null
  loading: boolean
}

function useBrainStatus() {
  const [nonce, setNonce] = useState(0)
  const [load, setLoad] = useState<Load>({ status: null, error: null, loading: true })

  useEffect(() => {
    let alive = true
    getKairosBrainStatus()
      .then((status) => { if (alive) setLoad({ status, error: null, loading: false }) })
      .catch((e: unknown) => {
        if (!alive) return
        const error = e instanceof Error && e.message ? e.message : 'Unknown error'
        setLoad((prev) => ({ status: prev.status, error, loading: false }))
      })
    return () => { alive = false }
  }, [nonce])

  const refresh = useCallback(() => {
    setLoad((prev) => ({ ...prev, loading: true, error: null }))
    setNonce((n) => n + 1)
  }, [])

  return { ...load, refresh }
}

function ModalBody({ onClose, defaultView }: { onClose: () => void; defaultView: BrainView }) {
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const { status, error, loading, refresh } = useBrainStatus()
  const [view, setView] = useState<BrainView>(defaultView)
  const [dir, setDir] = useState(1)

  const views = VIEWS.filter((v) => v.id !== 'telegram' || status?.isAdmin)
  const activeView = views.some((v) => v.id === view) ? view : 'status'

  const go = useCallback((next: BrainView) => {
    setDir(VIEWS.findIndex((v) => v.id === next) >= VIEWS.findIndex((v) => v.id === view) ? 1 : -1)
    setView(next)
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-kairos-title"
        initial={{ opacity: 0, scale: 0.85, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden mx-2 sm:mx-0 rounded-2xl border border-white/[0.12] flex flex-col relative"
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor}`,
            `0 25px 50px -12px ${colors.background}`,
          ].join(', '),
        }}
      >
        <div
          className="absolute top-0 left-6 right-6 h-[1.5px]"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
            boxShadow: `0 0 ${15 * mult}px ${3 * mult}px var(--glow-color)`,
          }}
        />

        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="text-[10px] font-medium uppercase tracking-[0.32em] px-3 py-1 rounded-full shrink-0"
              style={{
                color: 'var(--primary)',
                border: '1px solid var(--primary)',
                textShadow: '0 0 6px var(--glow-color)',
                background: tint('var(--background)', 40),
              }}
            >
              Kairos {KAIROS_VERSION_SHORT}
            </div>
            <div className="min-w-0">
              <h2 id="connect-kairos-title" className="text-lg font-semibold text-white leading-tight">Connect Kairos</h2>
              <p className="text-[11.5px] text-white/45">Its brain runs on your Claude Max plan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex justify-center px-5 pb-4 border-b border-white/10">
          <SegmentedSwitch options={views} value={activeView} onChange={go} layoutId="connect-kairos-view" label="Connect Kairos views" />
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 min-h-[460px]">
          {error && status && <StaleStrip at={status.generatedAt} onRetry={refresh} />}
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={activeView}
              role="tabpanel"
              custom={dir}
              initial={{ opacity: 0, x: 28 * dir }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -28 * dir }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {activeView === 'status' && (
                status ? (
                  <StatusView status={status} refreshing={loading} onRefresh={refresh} onNavigate={go} />
                ) : error ? (
                  <ErrorState message={error} onRetry={refresh} />
                ) : (
                  <StatusSkeleton />
                )
              )}
              {activeView === 'map' && <BrainMapView status={status} />}
              {activeView === 'connect' && <ConnectView status={status} />}
              {activeView === 'watched' && <WatchedView />}
              {activeView === 'voice' && <VoiceNotesView />}
              {activeView === 'routines' && <RoutinesView nowIso={status?.generatedAt} />}
              {activeView === 'telegram' && status?.isAdmin && <TelegramView telegram={status.telegram} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02]">
      <CloudOff className="w-6 h-6" style={{ color: 'var(--error)' }} />
      <div className="text-[14px] font-semibold text-white/90">Couldn’t check on Kairos</div>
      <p className="text-[12px] text-white/45 max-w-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium text-white/80 hover:text-white bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.10] transition"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Try again
      </button>
    </div>
  )
}

function StaleStrip({ at, onRetry }: { at: string; onRetry: () => void }) {
  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2 text-[11.5px]"
      style={{ borderColor: tint('var(--error)', 30), background: tint('var(--error)', 6) }}
    >
      <span className="text-white/70">Couldn’t refresh — showing what Kairos reported at {localClock(at)}.</span>
      <button type="button" onClick={onRetry} className="font-medium hover:brightness-125" style={{ color: 'var(--error)' }}>
        Try again
      </button>
    </div>
  )
}

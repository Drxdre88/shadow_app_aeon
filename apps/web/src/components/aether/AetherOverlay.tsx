'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import { useAetherUi } from './useAetherUi'
import { ReaderPane } from './ReaderPane'
import { NarrativeModal } from './NarrativeModal'
import { Legend } from './Legend'

// DOM overlay above the 3D field. One interaction model: click an orb to read
// it in the Reader pane; click the Core crystal (bottom-centre) to open the
// narrative modal. Legend + Reader are driven by the Kairos top-bar toggles;
// when shown they're floating panels constrained to this overlay.
export function AetherOverlay({ payload }: { payload: AetherPayload }) {
  const constraintsRef = useRef<HTMLDivElement>(null)
  const legendOpen = useAetherUi((s) => s.legendOpen)
  const readerOpen = useAetherUi((s) => s.readerOpen)
  const closeReader = useAetherUi((s) => s.closeReader)
  const narrativeOpen = useAetherUi((s) => s.narrativeOpen)
  const setNarrativeOpen = useAetherUi((s) => s.setNarrativeOpen)
  const selectedId = useAetherUi((s) => s.selectedId)
  const select = useAetherUi((s) => s.select)

  // Global Esc: close the narrative first, then the reader/selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (narrativeOpen) setNarrativeOpen(false)
      else if (readerOpen) closeReader()
      else if (selectedId) select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrativeOpen, readerOpen, selectedId, setNarrativeOpen, closeReader, select])

  return (
    <div
      ref={constraintsRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        overflow: 'hidden',
      }}
    >
      <AnimatePresence>
        {legendOpen && <Legend key="legend" constraintsRef={constraintsRef} />}
      </AnimatePresence>

      {/* Auto-blur the scene while a thought is being read (detail rolled out).
          Clicking the blurred field clears the selection. */}
      <AnimatePresence>
        {selectedId && (
          <motion.div
            key="scene-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => select(null)}
            style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'auto', background: 'rgba(4,2,12,0.42)', backdropFilter: 'blur(13px)' }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {readerOpen && <ReaderPane key="reader" payload={payload} />}
      </AnimatePresence>

      <CoreCrystal onOpen={() => setNarrativeOpen(true)} dimmed={narrativeOpen} />

      <AnimatePresence>
        {narrativeOpen && <NarrativeModal key="narrative" payload={payload} onClose={() => setNarrativeOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}

// The Core — a small crystal ball pinned at the bottom-centre of the view
// (immovable). Clicking it opens the centred narrative modal (which blurs the
// scene behind it). Gently pulses so it reads as alive.
function CoreCrystal({ onOpen, dimmed }: { onOpen: () => void; dimmed: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 7,
        opacity: dimmed ? 0 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      <motion.button
        onClick={onOpen}
        title="Core — open the narrative"
        whileHover={{ scale: 1.09 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          boxShadow: [
            '0 0 18px rgba(150,110,255,0.5), 0 0 44px rgba(120,80,255,0.22), inset 0 -6px 12px rgba(40,20,80,0.6), inset 0 7px 11px rgba(255,255,255,0.55)',
            '0 0 26px rgba(170,130,255,0.7), 0 0 60px rgba(130,90,255,0.32), inset 0 -6px 12px rgba(40,20,80,0.6), inset 0 7px 11px rgba(255,255,255,0.6)',
            '0 0 18px rgba(150,110,255,0.5), 0 0 44px rgba(120,80,255,0.22), inset 0 -6px 12px rgba(40,20,80,0.6), inset 0 7px 11px rgba(255,255,255,0.55)',
          ],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          cursor: 'pointer',
          border: '1px solid rgba(200,180,255,0.35)',
          padding: 0,
          background:
            'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.95) 0%, rgba(210,190,255,0.82) 14%, rgba(150,110,240,0.6) 42%, rgba(70,45,135,0.6) 74%, rgba(22,12,42,0.7) 100%)',
        }}
      />
      <span
        style={{
          fontSize: 8.5,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'rgba(210,196,250,0.6)',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          userSelect: 'none',
        }}
      >
        Core
      </span>
    </div>
  )
}

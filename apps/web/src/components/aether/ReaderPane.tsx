'use client'

import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { X, ChevronLeft } from 'lucide-react'
import type { AetherPayload, AetherThought } from '@/lib/kairos/aether-types'
import { useAetherUi } from './useAetherUi'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

function kindColor(kind: AetherThought['kind']): string {
  const map: Record<AetherThought['kind'], string> = {
    conclusion: 'rgba(130,200,255,0.9)',
    tension: 'rgba(255,110,110,0.9)',
    connection: 'rgba(130,255,190,0.9)',
    question: 'rgba(255,210,90,0.9)',
    eureka: 'rgba(220,170,255,1)',
  }
  return map[kind]
}

interface Section {
  key: string
  label: string
  thoughts: AetherThought[]
}

// The Reader — a draggable composite. The right column is JUST the headers
// (grouped ledger). Selecting a thought (here or by clicking its orb) rolls a
// readable detail panel out to the LEFT; the scene auto-blurs behind it
// (handled in AetherOverlay). Drag by the column header; resize its height by
// the bottom handle.
export function ReaderPane({ payload }: { payload: AetherPayload }) {
  const selectedId = useAetherUi((s) => s.selectedId)
  const select = useAetherUi((s) => s.select)
  const hover = useAetherUi((s) => s.hover)
  const closeReader = useAetherUi((s) => s.closeReader)

  const controls = useDragControls()
  const [colH, setColH] = useState(560)
  const resizing = useRef<{ y: number; h: number } | null>(null)

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    resizing.current = { y: e.clientY, h: colH }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizing.current) return
    setColH(Math.min(900, Math.max(260, resizing.current.h + (e.clientY - resizing.current.y))))
  }
  const onResizeUp = (e: React.PointerEvent) => {
    resizing.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const selected = selectedId ? payload.thoughts.find((t) => t.id === selectedId) ?? null : null

  const sections = useMemo<Section[]>(() => {
    const groups = new Map<string, AetherThought[]>()
    for (const t of payload.thoughts) {
      const key = t.dominionName ?? '—cross'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(t)
    }
    return [...groups.entries()]
      .map(([key, thoughts]) => ({
        key,
        label: key === '—cross' ? 'Cross-cutting' : key,
        thoughts: thoughts.sort((a, b) => b.salience - a.salience),
      }))
      .sort((a, b) => b.thoughts.length - a.thoughts.length)
  }, [payload.thoughts])

  return (
    <motion.div
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.03}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.4, ease: EASE }}
      style={{ position: 'absolute', top: 16, right: 16, zIndex: 45, pointerEvents: 'auto', display: 'flex', alignItems: 'flex-start', gap: 12 }}
      onMouseLeave={() => hover(null)}
    >
      {/* Detail — rolls out to the LEFT of the column on selection. */}
      <AnimatePresence mode="wait">
        {selected && (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, width: 0, x: 18 }}
            animate={{ opacity: 1, width: 344, x: 0 }}
            exit={{ opacity: 0, width: 0, x: 18 }}
            transition={{ duration: 0.36, ease: EASE }}
            style={{ overflow: 'hidden', flexShrink: 0, height: colH }}
          >
            <div
              style={{
                width: 344,
                height: colH,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                background: 'linear-gradient(180deg, rgba(12,9,26,0.95), rgba(6,4,16,0.93))',
                border: '1px solid rgba(160,130,255,0.26)',
                borderRadius: 12,
                boxShadow: '0 18px 60px rgba(0,0,0,0.6), 0 0 50px rgba(110,70,255,0.14)',
                backdropFilter: 'blur(14px)',
                padding: '18px 20px 22px',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}
            >
              <button
                onClick={() => select(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: 14, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(170,150,225,0.6)' }}
              >
                <ChevronLeft style={{ width: 12, height: 12 }} /> All thoughts
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: kindColor(selected.kind), boxShadow: `0 0 8px ${kindColor(selected.kind)}` }} />
                <span style={{ fontSize: 8.5, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700, color: kindColor(selected.kind) }}>
                  {selected.kind}
                </span>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 600, lineHeight: 1.25, color: 'rgba(246,241,255,0.97)' }}>
                {selected.title}
              </p>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'rgba(220,210,250,0.86)' }}>
                {selected.insight}
              </p>
              <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 16, borderTop: '1px solid rgba(140,110,255,0.14)' }}>
                <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(160,140,220,0.5)' }}>
                  {selected.sourceMemoryIds.length} source{selected.sourceMemoryIds.length === 1 ? '' : 's'}
                </span>
                {selected.dominionName && (
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(160,140,220,0.5)' }}>
                    {selected.dominionName}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header column (right) — drag by header, resize height by bottom handle. */}
      <div
        style={{
          width: 316,
          height: colH,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(10,8,22,0.93), rgba(6,4,16,0.9))',
          border: '1px solid rgba(160,130,255,0.2)',
          borderRadius: 12,
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(14px)',
          overflow: 'hidden',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}
      >
        <div
          onPointerDown={(e) => controls.start(e)}
          style={{ cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', borderBottom: '1px solid rgba(140,110,255,0.14)', flexShrink: 0 }}
        >
          <span style={{ flex: 1, fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(180,150,255,0.7)' }}>
            Reader
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={closeReader}
            title="Close (Esc)"
            style={{ cursor: 'pointer', display: 'flex', background: 'rgba(160,130,255,0.08)', border: '1px solid rgba(160,130,255,0.22)', borderRadius: 6, color: 'rgba(200,185,255,0.7)', padding: 5 }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map((section) => (
            <div key={section.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 8.5, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(180,150,255,0.6)' }}>
                {section.label}
                <span style={{ flex: 1, height: 1, background: 'rgba(160,130,255,0.14)' }} />
                <span style={{ color: 'rgba(160,140,220,0.4)' }}>{section.thoughts.length}</span>
              </div>

              {section.thoughts.map((t) => {
                const active = t.id === selectedId
                return (
                  <button
                    key={t.id}
                    onClick={() => select(t.id)}
                    onMouseEnter={() => hover(t.id)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '8px 10px',
                      borderRadius: 7,
                      border: `1px solid ${active ? 'rgba(160,130,255,0.5)' : 'rgba(160,130,255,0.1)'}`,
                      background: active
                        ? 'linear-gradient(160deg, rgba(22,15,46,0.95), rgba(12,8,30,0.82))'
                        : 'rgba(8,6,20,0.5)',
                      boxShadow: active ? '0 0 16px rgba(110,70,255,0.25)' : 'none',
                      transition: 'border 0.15s, background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: kindColor(t.kind), boxShadow: `0 0 6px ${kindColor(t.kind)}` }} />
                      <span style={{ fontSize: 7.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: kindColor(t.kind) }}>
                        {t.kind}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: active ? 'rgba(245,240,255,0.98)' : 'rgba(220,212,250,0.85)' }}>
                      {t.title}
                    </p>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Vertical resize handle */}
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          title="Drag to resize height"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 11, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ width: 34, height: 3, borderRadius: 2, background: 'rgba(160,130,255,0.4)' }} />
        </div>
      </div>
    </motion.div>
  )
}

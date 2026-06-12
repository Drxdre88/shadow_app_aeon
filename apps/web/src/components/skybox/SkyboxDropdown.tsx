'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'
import { SKYBOXES, SKYBOX_BY_ID, type SkyboxId, type SkyboxOption } from './skyboxes'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

// Dropdown is grouped by format so a growing library stays scannable.
const GROUPS: { format: SkyboxOption['format']; label: string }[] = [
  { format: 'png', label: 'Classic' },
  { format: 'hdr', label: 'HDR Worlds' },
]

function Swatch({ gradient, size = 18 }: { gradient: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient,
        boxShadow: 'inset 0 0 6px rgba(0,0,0,0.6), 0 0 8px rgba(120,90,255,0.35)',
        border: '1px solid rgba(255,255,255,0.18)',
        flexShrink: 0,
      }}
    />
  )
}

// Glassy skybox picker shared by Kairos and Aether. Self-contained: owns its
// open state, closes on outside-click / Escape. Drop it anywhere absolutely
// positioned by the parent.
export function SkyboxDropdown({
  value,
  onChange,
  align = 'right',
}: {
  value: SkyboxId
  onChange: (id: SkyboxId) => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = SKYBOX_BY_ID[value] ?? SKYBOXES[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const panelPos: CSSProperties =
    align === 'right' ? { right: 0 } : { left: 0 }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', pointerEvents: 'auto', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '6px 10px 6px 8px',
          borderRadius: 999,
          cursor: 'pointer',
          background: 'rgba(8,6,20,0.6)',
          border: `1px solid ${open ? 'rgba(160,130,255,0.5)' : 'rgba(160,130,255,0.2)'}`,
          boxShadow: open ? '0 0 18px rgba(120,80,255,0.3)' : 'none',
          backdropFilter: 'blur(10px)',
          color: 'rgba(235,228,255,0.92)',
          transition: 'border 0.18s, box-shadow 0.18s',
        }}
      >
        <Swatch gradient={current.swatch} />
        <span style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          {current.label}
        </span>
        <ChevronDown
          style={{
            width: 13,
            height: 13,
            opacity: 0.6,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: EASE }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              ...panelPos,
              width: 244,
              maxHeight: 'min(70vh, 460px)',
              overflowY: 'auto',
              padding: 5,
              borderRadius: 12,
              background: 'linear-gradient(160deg, rgba(14,10,30,0.96), rgba(7,5,18,0.92))',
              border: '1px solid rgba(160,130,255,0.22)',
              boxShadow:
                '0 12px 40px rgba(0,0,0,0.55), inset 0 0 24px rgba(120,80,255,0.06), 0 0 24px rgba(90,50,200,0.18)',
              backdropFilter: 'blur(16px)',
              zIndex: 60,
            }}
          >
            {GROUPS.map((g) => {
              const items = SKYBOXES.filter((s) => s.format === g.format)
              if (items.length === 0) return null
              return (
                <div key={g.format} style={{ marginBottom: 2 }}>
                  <div
                    style={{
                      padding: '7px 10px 4px',
                      fontSize: 8,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: 'rgba(170,150,225,0.45)',
                    }}
                  >
                    {g.label}
                  </div>
                  {items.map((s) => {
                    const active = s.id === value
                    return (
                      <button
                        key={s.id}
                        onClick={() => { onChange(s.id); setOpen(false) }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 11,
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          background: active ? 'rgba(140,100,255,0.16)' : 'transparent',
                          transition: 'background 0.14s',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(160,130,255,0.08)'
                        }}
                        onMouseLeave={(e) => {
                          if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <Swatch gradient={s.swatch} size={24} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: active ? 'rgba(245,240,255,0.98)' : 'rgba(225,218,250,0.85)',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {s.label}
                          </div>
                          <div
                            style={{
                              fontSize: 8.5,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: 'rgba(170,150,225,0.55)',
                              marginTop: 1,
                            }}
                          >
                            {s.hint}
                          </div>
                        </div>
                        {active && <Check style={{ width: 13, height: 13, color: 'rgba(190,160,255,0.95)', flexShrink: 0 }} />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

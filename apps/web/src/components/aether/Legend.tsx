'use client'

import { type RefObject } from 'react'
import { X } from 'lucide-react'
import { useAetherUi } from './useAetherUi'
import { FloatingPanel } from './FloatingPanel'

const KINDS: { label: string; color: string }[] = [
  { label: 'Eureka', color: 'rgba(220,170,255,1)' },
  { label: 'Conclusion', color: 'rgba(130,200,255,0.9)' },
  { label: 'Tension', color: 'rgba(255,110,110,0.9)' },
  { label: 'Connection', color: 'rgba(130,255,190,0.9)' },
  { label: 'Question', color: 'rgba(255,210,90,0.9)' },
]

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, color: 'rgba(210,200,240,0.7)' }}>
    {children}
  </div>
)

// The key explaining what the orbs encode. Visibility is driven by the top-bar
// Legend toggle; when shown it's a draggable floating panel (starts top-left).
export function Legend({ constraintsRef }: { constraintsRef?: RefObject<HTMLElement | null> }) {
  const setLegendOpen = useAetherUi((s) => s.setLegendOpen)

  return (
    <FloatingPanel
      initial={{ top: 16, left: 16 }}
      width={196}
      zIndex={30}
      constraintsRef={constraintsRef}
      panelStyle={{
        borderRadius: 10,
        background: 'linear-gradient(160deg, rgba(12,9,26,0.92), rgba(6,4,18,0.86))',
        border: '1px solid rgba(160,130,255,0.2)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(14px)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 6px' }}>
          <span style={{ flex: 1, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(200,185,240,0.7)' }}>
            Legend
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setLegendOpen(false)}
            title="Hide legend"
            style={{ cursor: 'pointer', display: 'flex', background: 'none', border: 'none', padding: 2, color: 'rgba(190,175,235,0.6)' }}
          >
            <X style={{ width: 12, height: 12 }} />
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 13px 13px' }}>
        <Row>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(180,150,255,0.8)' }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(180,150,255,0.8)' }} />
          </span>
          Size — importance
        </Row>
        <Row>
          <span style={{ display: 'flex', gap: 2 }}>
            {['#7d4ad6', '#3a8ad6', '#3ad68a', '#d6c23a'].map((c) => (
              <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
            ))}
          </span>
          Hue — Dominion
        </Row>

        <div style={{ height: 1, background: 'rgba(160,130,255,0.12)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {KINDS.map((k) => (
            <Row key={k.label}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: k.color, boxShadow: `0 0 6px ${k.color}` }} />
              {k.label}
            </Row>
          ))}
        </div>
      </div>
    </FloatingPanel>
  )
}

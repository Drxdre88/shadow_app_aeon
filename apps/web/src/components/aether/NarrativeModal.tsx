'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import { Bullet, highlight, splitSentences, entityList } from './narrativeText'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

function formatRecency(iso: string): { absolute: string; relative: string } {
  const d = new Date(iso)
  const absolute = d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  let relative: string
  if (mins < 1) relative = 'just now'
  else if (mins < 60) relative = `${mins}m ago`
  else if (mins < 1440) relative = `${Math.round(mins / 60)}h ago`
  else relative = `${Math.round(mins / 1440)}d ago`
  return { absolute, relative }
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(240,234,255,0.95)' }}>{value}</span>
      <span style={{ fontSize: 8.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(160,145,215,0.55)' }}>{label}</span>
    </div>
  )
}

// Wide, focused reading view for the full synthesis — blurs the scene and puts
// the narrative front and centre, with generation date / recency on top.
export function NarrativeModal({ payload, onClose }: { payload: AetherPayload; onClose: () => void }) {
  const entities = useMemo(() => entityList(payload.thoughts), [payload.thoughts])
  const sentences = useMemo(() => splitSentences(payload.coreNarrative), [payload.coreNarrative])
  const { absolute, relative } = useMemo(() => formatRecency(payload.generatedAt), [payload.generatedAt])

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 70, pointerEvents: 'none' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(3,2,10,0.58)', backdropFilter: 'blur(18px)', pointerEvents: 'auto' }}
      />

      {/* Flex-centring wrapper — framer sets `transform` for the scale/y
          animation, so we must NOT also use a translate transform to centre
          (it would be overwritten and the modal would drift off-centre). */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, pointerEvents: 'none' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.5, ease: EASE }}
          style={{
            width: 'min(720px, 100%)',
            maxHeight: '84%',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            background: 'linear-gradient(160deg, rgba(13,10,28,0.96), rgba(6,4,18,0.94))',
            border: '1px solid var(--primary-muted, rgba(160,130,255,0.3))',
            borderRadius: 18,
            boxShadow: '0 28px 90px rgba(0,0,0,0.62), 0 0 70px var(--glow-color, rgba(110,70,255,0.16)), inset 0 0 34px rgba(140,100,255,0.05)',
            padding: '26px 34px 30px',
          }}
        >
        {/* Header — title + recency + counts. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingBottom: 16, borderBottom: '1px solid rgba(140,110,255,0.16)', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--accent, rgba(180,150,255,0.7))', marginBottom: 7 }}>
              Aether — Core Narrative
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'rgba(220,212,250,0.75)' }}>{absolute}</span>
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 999, background: 'rgba(140,100,255,0.16)', border: '1px solid rgba(160,130,255,0.25)', color: 'rgba(210,195,255,0.85)', letterSpacing: '0.08em' }}>
                {relative}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <Stat value={payload.thoughts.length} label="thoughts" />
            <Stat value={payload.tensions.length} label="tensions" />
            <button
              onClick={onClose}
              style={{ flexShrink: 0, cursor: 'pointer', display: 'flex', background: 'rgba(160,130,255,0.08)', border: '1px solid rgba(160,130,255,0.22)', borderRadius: 7, color: 'rgba(200,185,255,0.7)', padding: 6 }}
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>

        {/* Body — comfortable, wide reading. */}
        <div style={{ overflowY: 'auto', paddingRight: 6 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 13 }}>
            {sentences.map((s, i) => (
              <Bullet key={i} size={15}>{highlight(s, entities)}</Bullet>
            ))}
          </ul>

          {payload.shifts.length > 0 && (
            <>
              <div style={{ fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(160,140,220,0.5)', margin: '22px 0 11px' }}>
                Shifts since last synthesis
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {payload.shifts.map((s, i) => (
                  <Bullet key={i} dim size={13.5}>{highlight(s, entities)}</Bullet>
                ))}
              </ul>
            </>
          )}
        </div>
        </motion.div>
      </div>
    </div>
  )
}

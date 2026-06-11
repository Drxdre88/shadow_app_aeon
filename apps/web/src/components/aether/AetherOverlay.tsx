'use client'

import type { CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AetherPayload, AetherThought } from '@/lib/kairos/aether-types'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const GLASS: CSSProperties = {
  position: 'relative',
  background:
    'linear-gradient(160deg, rgba(8,6,20,0.82) 0%, rgba(4,3,14,0.65) 100%)',
  border: '1px solid rgba(160,130,255,0.28)',
  boxShadow:
    'inset 0 0 22px rgba(140,100,255,0.06), 0 0 16px rgba(110,70,255,0.22), 0 0 48px rgba(80,40,200,0.10)',
  borderRadius: 6,
  padding: '16px 18px',
}

const CORNER_H = 10
const CORNER_COLOR = 'rgba(170,140,255,0.6)'

function CornerBrackets() {
  const s: CSSProperties = {
    position: 'absolute',
    width: CORNER_H,
    height: CORNER_H,
    pointerEvents: 'none',
  }
  const b = `1px solid ${CORNER_COLOR}`
  return (
    <>
      <span style={{ ...s, top: -1, left: -1, borderTop: b, borderLeft: b }} />
      <span style={{ ...s, top: -1, right: -1, borderTop: b, borderRight: b }} />
      <span style={{ ...s, bottom: -1, left: -1, borderBottom: b, borderLeft: b }} />
      <span style={{ ...s, bottom: -1, right: -1, borderBottom: b, borderRight: b }} />
    </>
  )
}

function kindLabel(kind: AetherThought['kind']): string {
  const map: Record<AetherThought['kind'], string> = {
    conclusion: 'CONCLUSION',
    tension: 'TENSION',
    connection: 'CONNECTION',
    question: 'QUESTION',
    eureka: 'EUREKA',
  }
  return map[kind]
}

function kindColor(kind: AetherThought['kind']): string {
  const map: Record<AetherThought['kind'], string> = {
    conclusion: 'rgba(130,200,255,0.75)',
    tension: 'rgba(255,110,110,0.75)',
    connection: 'rgba(130,255,190,0.75)',
    question: 'rgba(255,210,90,0.75)',
    eureka: 'rgba(220,170,255,1)',
  }
  return map[kind]
}

export function AetherOverlay({
  payload,
  selectedId,
  onSelect,
}: {
  payload: AetherPayload
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const selectedThought = selectedId
    ? payload.thoughts.find((t) => t.id === selectedId) ?? null
    : null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >
      <motion.div
        style={{
          position: 'absolute',
          bottom: 32,
          left: 28,
          width: 320,
          pointerEvents: 'auto',
        }}
        initial={{ opacity: 0, filter: 'blur(14px) brightness(1.9) saturate(0.4)' }}
        animate={{
          opacity: [0, 0.6, 0.95, 1],
          filter: [
            'blur(14px) brightness(1.9) saturate(0.4)',
            'blur(6px) brightness(1.3) saturate(0.7)',
            'blur(1.5px) brightness(1.05) saturate(0.95)',
            'blur(0px) brightness(1) saturate(1)',
          ],
        }}
        transition={{ duration: 1.2, delay: 0.3, times: [0, 0.45, 0.8, 1], ease: EASE }}
      >
        <div style={GLASS}>
          <CornerBrackets />
          <p
            style={{
              margin: 0,
              fontSize: 9,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(170,140,255,0.55)',
              marginBottom: 8,
            }}
          >
            Aether — Core Narrative
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.65,
              color: 'rgba(230,220,255,0.88)',
            }}
          >
            {payload.coreNarrative}
          </p>
          {payload.shifts.length > 0 && (
            <ul
              style={{
                margin: '10px 0 0',
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {payload.shifts.map((s, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 10,
                    color: 'rgba(190,170,255,0.6)',
                    paddingLeft: 10,
                    borderLeft: '2px solid rgba(160,120,255,0.3)',
                  }}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.18, 0.05, 0] }}
          transition={{ duration: 1.2, delay: 0.3, times: [0, 0.4, 0.75, 1], ease: 'easeOut' }}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            inset: 0,
            borderRadius: 6,
            background:
              'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(140,100,255,0.16) 100%)',
            mixBlendMode: 'screen',
          }}
        />
      </motion.div>

      <AnimatePresence>
        {selectedThought && (
          <motion.div
            key={selectedThought.id}
            style={{
              position: 'absolute',
              top: 28,
              right: 28,
              width: 340,
              pointerEvents: 'auto',
            }}
            initial={{ opacity: 0, x: 24, filter: 'blur(8px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: 16, filter: 'blur(6px)' }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div style={GLASS}>
              <CornerBrackets />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                  gap: 8,
                }}
              >
                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 8,
                      letterSpacing: '0.2em',
                      fontWeight: 700,
                      color: kindColor(selectedThought.kind),
                      textShadow: `0 0 8px ${kindColor(selectedThought.kind)}`,
                      marginBottom: 5,
                    }}
                  >
                    {kindLabel(selectedThought.kind)}
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'rgba(240,235,255,0.95)',
                      lineHeight: 1.3,
                    }}
                  >
                    {selectedThought.title}
                  </p>
                </div>
                <button
                  onClick={() => onSelect(null)}
                  style={{
                    flexShrink: 0,
                    background: 'rgba(160,130,255,0.08)',
                    border: '1px solid rgba(160,130,255,0.22)',
                    borderRadius: 4,
                    color: 'rgba(200,185,255,0.7)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: '3px 8px',
                    lineHeight: 1,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(160,130,255,0.18)'
                    ;(e.currentTarget as HTMLButtonElement).style.color =
                      'rgba(220,210,255,1)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(160,130,255,0.08)'
                    ;(e.currentTarget as HTMLButtonElement).style.color =
                      'rgba(200,185,255,0.7)'
                  }}
                >
                  ✕
                </button>
              </div>

              <p
                style={{
                  margin: '0 0 12px',
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'rgba(215,205,255,0.82)',
                }}
              >
                {selectedThought.insight}
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(140,110,255,0.15)',
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.14em',
                    color: 'rgba(160,140,220,0.5)',
                    textTransform: 'uppercase',
                  }}
                >
                  sources: {selectedThought.sourceMemoryIds.length} memor
                  {selectedThought.sourceMemoryIds.length === 1 ? 'y' : 'ies'}
                </span>
                {selectedThought.dominionName && (
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.12em',
                      color: 'rgba(160,140,220,0.5)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {selectedThought.dominionName}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

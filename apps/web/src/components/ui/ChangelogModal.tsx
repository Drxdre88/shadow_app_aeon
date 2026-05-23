'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ScrollText, X } from 'lucide-react'
import { CHANGELOG_MD } from '@/lib/changelog'
import { APP_VERSION } from '@/lib/version'
import { useThemeStore } from '@/stores/themeStore'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { Tooltip } from './Tooltip'

// Aeon area pills — fixed colours so a category keeps its identity across
// every theme. The user remembers "KAIROS = violet, DOMINION = orange".
const AREA_PILLS: Record<string, string> = {
  BOARD:    '#06b6d4', // cyan
  GANTT:    '#f59e0b', // amber
  CANVAS:   '#d946ef', // fuchsia
  KAIROS:   '#8b5cf6', // violet
  DOMINION: '#f97316', // orange
  REALM:    '#10b981', // emerald
  AUTH:     '#ef4444', // red
  MCP:      '#3b82f6', // blue
  API:      '#64748b', // slate
  DATA:     '#14b8a6', // teal
  INFRA:    '#a855f7', // purple
  DOCS:     '#ec4899', // pink
  UI:       '#0ea5e9', // sky
}

type Line =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'li';  text: string }
  | { kind: 'p';   text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'blank' }

function parse(md: string): Line[] {
  return md.split('\n').map<Line>((raw) => {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') return { kind: 'blank' }
    if (line.startsWith('# '))  return { kind: 'h1', text: line.slice(2) }
    if (line.startsWith('## ')) return { kind: 'h2', text: line.slice(3) }
    if (line.startsWith('### ')) return { kind: 'h3', text: line.slice(4) }
    if (line.startsWith('- '))  return { kind: 'li', text: line.slice(2) }
    if (line.startsWith('> '))  return { kind: 'quote', text: line.slice(2) }
    return { kind: 'p', text: line }
  })
}

function inline(text: string, primary: string, uppercasePlain = false): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  const plain = (s: string) => (uppercasePlain ? s.toUpperCase() : s)

  while (i < text.length) {
    const boldStart = text.indexOf('**', i)
    const codeStart = text.indexOf('`', i)
    const candidates = [boldStart, codeStart].filter((n) => n !== -1).sort((a, b) => a - b)
    const next = candidates[0]
    if (next === undefined) {
      out.push(plain(text.slice(i)))
      break
    }
    if (next > i) out.push(plain(text.slice(i, next)))

    if (next === boldStart) {
      const end = text.indexOf('**', boldStart + 2)
      if (end === -1) { out.push(text.slice(next)); break }
      out.push(
        <strong key={key++} style={{ color: primary, fontWeight: 700 }}>
          {text.slice(boldStart + 2, end)}
        </strong>
      )
      i = end + 2
    } else {
      const end = text.indexOf('`', codeStart + 1)
      if (end === -1) { out.push(text.slice(next)); break }
      const content = text.slice(codeStart + 1, end)
      const pillColor = AREA_PILLS[content]
      if (pillColor) {
        out.push(
          <span
            key={key++}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontWeight: 700,
              padding: '1px 7px',
              color: pillColor,
              backgroundColor: `color-mix(in srgb, ${pillColor} 18%, transparent)`,
              border: `1px solid color-mix(in srgb, ${pillColor} 45%, transparent)`,
              borderRadius: 4,
              fontSize: '0.72em',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              marginInline: 1,
            }}
          >
            {content}
          </span>
        )
      } else {
        out.push(
          <code
            key={key++}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              padding: '1px 5px',
              backgroundColor: `color-mix(in srgb, ${primary} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${primary} 18%, transparent)`,
              borderRadius: 3,
              fontSize: '0.88em',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            {content}
          </code>
        )
      }
      i = end + 1
    }
  }
  return out
}

interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const lines = useMemo(() => parse(CHANGELOG_MD), [])
  const primary = colors.primary

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onKey])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-lg flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.88, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28, mass: 0.85 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl h-[85vh] mx-2 sm:mx-0 rounded-2xl border flex flex-col overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${colors.background}f8, ${colors.background}e8, ${colors.background})`,
          borderColor: 'rgba(255,255,255,0.12)',
          boxShadow: [
            `0 0 ${70 * mult}px ${18 * mult}px ${colors.glowColor}`,
            '0 28px 60px -15px rgba(0,0,0,0.85)',
            'inset 0 1px 0 0 rgba(255,255,255,0.08)',
          ].join(', '),
        }}
      >
        {/* Top gradient seam */}
        <div
          className="absolute top-0 left-8 right-8 h-[2px] pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent, ${primary}, ${colors.glowColor}, ${primary}, transparent)`,
            boxShadow: `0 0 ${18 * mult}px ${4 * mult}px ${colors.glowColor}`,
          }}
        />

        {/* Ambient glow halo behind header */}
        <div
          className="absolute top-0 left-0 right-0 h-44 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${colors.glowColor}18, transparent 70%)`,
          }}
        />

        {/* Header strip */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${primary}30, ${colors.glowColor}20)`,
                border: `1px solid ${primary}40`,
                boxShadow: `0 0 18px ${colors.glowColor}40`,
              }}
            >
              <ScrollText className="w-5 h-5" style={{ color: primary }} />
            </div>
            <div>
              <div className="flex items-baseline gap-3">
                <h2
                  className="text-lg font-bold tracking-[0.3em] text-white"
                  style={{ textShadow: `0 0 14px ${colors.glowColor}` }}
                >
                  CHANGELOG
                </h2>
                <span
                  className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-white/40"
                >
                  CURRENT BUILD · v{APP_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">What shipped, when, and why</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close changelog"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 relative z-10" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {lines.map((l, i) => {
            if (l.kind === 'blank') return <div key={i} className="h-3" />

            if (l.kind === 'h1') return (
              <h1
                key={i}
                className="font-bold tracking-[0.25em]"
                style={{
                  fontSize: 18,
                  color: primary,
                  textShadow: `0 0 12px ${colors.glowColor}`,
                  marginTop: i === 0 ? 0 : 24,
                  marginBottom: 8,
                }}
              >
                {inline(l.text, primary, true)}
              </h1>
            )

            if (l.kind === 'h2') return (
              <h2
                key={i}
                className="font-bold tracking-[0.2em]"
                style={{
                  fontSize: 14,
                  color: primary,
                  marginTop: 28,
                  marginBottom: 8,
                  paddingBottom: 6,
                  borderBottom: `1px solid color-mix(in srgb, ${primary} 28%, transparent)`,
                }}
              >
                {inline(l.text, primary, true)}
              </h2>
            )

            if (l.kind === 'h3') return (
              <h3
                key={i}
                className="font-bold tracking-[0.15em]"
                style={{
                  fontSize: 11.5,
                  color: `color-mix(in srgb, ${primary} 70%, white)`,
                  marginTop: 18,
                  marginBottom: 6,
                }}
              >
                {inline(l.text, primary, true)}
              </h3>
            )

            if (l.kind === 'quote') return (
              <div
                key={i}
                className="my-3 pl-3 py-2 rounded-r"
                style={{
                  borderLeft: `2px solid color-mix(in srgb, ${primary} 50%, transparent)`,
                  background: `color-mix(in srgb, ${primary} 5%, transparent)`,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.72)',
                }}
              >
                {inline(l.text, primary)}
              </div>
            )

            if (l.kind === 'li') return (
              <div key={i} className="flex gap-2.5 items-start" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 3 }}>
                <span style={{ color: primary, opacity: 0.65, marginTop: 2 }}>▸</span>
                <span style={{ flex: 1 }}>{inline(l.text, primary)}</span>
              </div>
            )

            return (
              <p key={i} style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                {inline(l.text, primary)}
              </p>
            )
          })}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export function ChangelogButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  return (
    <>
      <Tooltip label="Changelog">
        <motion.button
          onClick={() => setIsOpen(true)}
          aria-label="Changelog"
          className="relative p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            boxShadow: glowIntensity > 50
              ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}`
              : 'none',
          }}
        >
          <ScrollText className="w-5 h-5 text-current" />
        </motion.button>
      </Tooltip>

      <ChangelogModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

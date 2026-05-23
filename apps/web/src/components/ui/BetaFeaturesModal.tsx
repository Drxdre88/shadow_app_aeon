'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  FlaskConical,
  LayoutGrid,
  Calendar,
  Lightbulb,
  Brain,
  Globe,
  Network,
  Code2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { Tooltip } from './Tooltip'
import { cn } from '@/lib/utils/cn'

type Maturity = 'live' | 'beta' | 'preview'

const MATURITY: Record<Maturity, { label: string; tone: string }> = {
  live:    { label: 'LIVE',    tone: '#10b981' },
  beta:    { label: 'BETA',    tone: '#f59e0b' },
  preview: { label: 'PREVIEW', tone: '#94a3b8' },
}

interface FeatureRow {
  title: string
  description: string
  maturity: Maturity
}

interface FeatureGroup {
  id: string
  title: string
  tagline: string
  icon: LucideIcon
  accent: string
  features: FeatureRow[]
}

const GROUPS: FeatureGroup[] = [
  {
    id: 'board',
    title: 'Board',
    tagline: 'Kanban that bends to how you actually work.',
    icon: LayoutGrid,
    accent: '#06b6d4',
    features: [
      { title: 'Drag-and-drop columns and cards', description: 'Reorder anything, anywhere — smooth animations, ghost previews, no flicker.', maturity: 'live' },
      { title: 'Custom columns + labels + priorities', description: 'Right-click for context menus. Build the workflow you want, not the one the tool wants.', maturity: 'live' },
      { title: 'Dependencies with visual overlays', description: 'Blocker / blocked arrows, glow trees, toggle on / off without losing the connection.', maturity: 'live' },
      { title: 'Grouped tri-state checklists', description: 'Todo / doing / done per item, sortable groups, progress on cards.', maturity: 'live' },
      { title: 'Vault archive + trophy room', description: 'Park completed work, restore it anytime, see what you shipped this month.', maturity: 'live' },
      { title: 'Filters that compose', description: 'Text + priority + label + column + date, all stackable. No modal — inline.', maturity: 'live' },
      { title: 'Keyboard-driven', description: 'Eight customisable shortcuts. C / E / V / L / G / D / N / ?. Cmd+K for everything else.', maturity: 'live' },
      { title: 'Virtual scrolling on big boards', description: 'TanStack Virtual kicks in past 15 cards. Smooth at thousands.', maturity: 'live' },
    ],
  },
  {
    id: 'gantt',
    title: 'Gantt',
    tagline: 'Timelines without the enterprise bloat.',
    icon: Calendar,
    accent: '#f59e0b',
    features: [
      { title: 'Drag-resize task bars', description: 'Day / week / month scale. Pull the edge, the dates follow.', maturity: 'beta' },
      { title: 'Swim-lane rows', description: 'Group tasks into named lanes. Reorder lanes by drag.', maturity: 'beta' },
      { title: 'Saved views', description: 'Each named view remembers its group-by, filters, and scale.', maturity: 'beta' },
      { title: 'Board ↔ Gantt sync', description: 'Push a card to the timeline. It stays linked — edit either side, both update.', maturity: 'beta' },
    ],
  },
  {
    id: 'canvas',
    title: 'Canvas',
    tagline: 'Freeform space for thinking before structuring.',
    icon: Lightbulb,
    accent: '#d946ef',
    features: [
      { title: 'Infinite node-edge whiteboard', description: 'Idea nodes, process nodes, connect anything. ReactFlow under the hood.', maturity: 'preview' },
      { title: 'Auto-layout with dagre', description: 'One click to untangle. Or arrange by hand — your choice.', maturity: 'preview' },
      { title: 'Export to image', description: 'PNG snapshot of the canvas, ready to drop into a doc.', maturity: 'preview' },
    ],
  },
  {
    id: 'kairos',
    title: 'Kairos',
    tagline: 'Your memory layer, visualised. Powered by Claude.',
    icon: Brain,
    accent: '#8b5cf6',
    features: [
      { title: '2D + 3D WebGL graph of your memories', description: 'Orthographic plane or full 3D — every captured thought becomes a planet, every link becomes a glowing edge.', maturity: 'beta' },
      { title: 'AI-cleaned titles and exec summaries', description: 'Each memory has a 1–6 word AI title and a 5–10 bullet exec summary, generated at capture time.', maturity: 'beta' },
      { title: 'Cross-repo connections via Dominions', description: 'Group your work into Dominions. Memories in the same Dominion connect across repos automatically.', maturity: 'beta' },
      { title: 'Search + budget-packed context', description: 'Full-text search, plus a "prepare context" mode that builds a token-budgeted bundle ready to paste into another chat.', maturity: 'beta' },
      { title: 'Backfill old memories from chat', description: 'One MCP tool returns every memory missing a summary so Claude can loop through and fill them in.', maturity: 'beta' },
      { title: 'In-app Setup + Guide', description: 'Tap the Kairos pill in the sidebar to walk through MCP setup and learn the model.', maturity: 'beta' },
    ],
  },
  {
    id: 'realms',
    title: 'Realms',
    tagline: 'Fluid workspaces. No rigid org chart.',
    icon: Globe,
    accent: '#10b981',
    features: [
      { title: 'Workspace groups with member roles', description: 'Owner / editor / viewer. Each realm is its own scope; projects can live in many.', maturity: 'live' },
      { title: 'Token invites with email delivery', description: 'Generate a link, send through Resend, 7-day expiry, role baked in.', maturity: 'live' },
      { title: 'Scoped visibility', description: 'A project shows in a realm only when you say so. Realms aren\'t a wrapper — they\'re a lens.', maturity: 'live' },
      { title: 'Custom icons + colours', description: '16 icons, 7 base colours that flow through the realm\'s glow palette.', maturity: 'live' },
    ],
  },
  {
    id: 'platform',
    title: 'Platform',
    tagline: 'API-first. AI-first. Yours-first.',
    icon: Code2,
    accent: '#3b82f6',
    features: [
      { title: '76 MCP tools across 13 categories', description: 'Claude Code talks to Aeon natively. Manage boards, projects, memories, Dominions — by voice or by chat.', maturity: 'live' },
      { title: 'REST API with key auth', description: 'Every MCP capability mirrors to a REST route. Parity locked by a test that fails CI on drift.', maturity: 'live' },
      { title: 'Real-time multi-user sync', description: 'Pusher channels push every mutation in ~1s. 30-second polling as fallback when Pusher is offline.', maturity: 'live' },
      { title: 'Full JSON export', description: 'Download everything you\'ve ever put in. Your data, no lock-in.', maturity: 'live' },
      { title: 'PWA install + Capacitor mobile shell', description: 'Add to home screen on desktop or mobile. Native shell ready for App Store submission.', maturity: 'beta' },
    ],
  },
  {
    id: 'craft',
    title: 'Craft',
    tagline: 'The details that make it yours.',
    icon: Sparkles,
    accent: '#ec4899',
    features: [
      { title: '151 theme presets across 17 categories', description: 'Or build your own with saturation, brightness, and glow controls.', maturity: 'live' },
      { title: 'Glow source picker', description: 'Card glow follows priority, label, or column — your call.', maturity: 'live' },
      { title: '13 visual effects', description: 'Starfield, sakura, snowfall, matrix, storm, aurora. Disable per-page or globally.', maturity: 'live' },
      { title: 'Six celebration categories', description: 'Complete a task, get a little something. Subtle by default, dial it up if you want fireworks.', maturity: 'live' },
      { title: 'Undo / redo with a 20-step history', description: 'Every mutation goes through the undo stack. Cmd+Z, even on the board.', maturity: 'live' },
    ],
  },
]

const BETA_VERSION = 3
const STORAGE_KEY = `aeon-beta-features-seen-v${BETA_VERSION}`

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function BetaFeaturesModal({ isOpen, onClose }: Props) {
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const [activeId, setActiveId] = useState(GROUPS[0].id)
  const active = useMemo(() => GROUPS.find((g) => g.id === activeId) ?? GROUPS[0], [activeId])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const idx = GROUPS.findIndex((g) => g.id === activeId)
      const next = e.key === 'ArrowDown' ? (idx + 1) % GROUPS.length : (idx - 1 + GROUPS.length) % GROUPS.length
      setActiveId(GROUPS[next].id)
      e.preventDefault()
    }
  }, [activeId, onClose])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onKey])

  if (!mounted || !isOpen) return null

  const accent = active.accent
  const totalFeatures = GROUPS.reduce((n, g) => n + g.features.length, 0)

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26, mass: 0.9 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl h-[85vh] mx-3 sm:mx-0 rounded-2xl border flex overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${colors.background}f8, ${colors.background}ec, ${colors.background})`,
          borderColor: 'rgba(255,255,255,0.12)',
          boxShadow: [
            `0 0 ${90 * mult}px ${24 * mult}px ${colors.glowColor}`,
            '0 35px 80px -20px rgba(0,0,0,0.9)',
            'inset 0 1px 0 0 rgba(255,255,255,0.08)',
          ].join(', '),
        }}
      >
        {/* Ambient orb that drifts with active group */}
        <motion.div
          className="absolute pointer-events-none"
          animate={{
            background: `radial-gradient(circle at center, ${accent}25, transparent 70%)`,
          }}
          transition={{ duration: 0.6 }}
          style={{
            top: -120,
            right: -120,
            width: 480,
            height: 480,
            filter: 'blur(40px)',
            opacity: 0.9,
          }}
        />

        {/* Top gradient seam */}
        <div
          className="absolute top-0 left-10 right-10 h-[2px] pointer-events-none z-20"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}, ${colors.glowColor}, ${accent}, transparent)`,
            boxShadow: `0 0 ${22 * mult}px ${6 * mult}px ${accent}`,
          }}
        />

        {/* Left rail — group nav */}
        <aside
          className="relative w-[240px] shrink-0 border-r border-white/[0.06] flex flex-col z-10"
          style={{ background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="px-5 py-5 border-b border-white/[0.06]">
            <div
              className="text-[10px] font-mono tracking-[0.4em] text-white/40"
              style={{ textShadow: `0 0 8px ${colors.glowColor}` }}
            >
              AEON · FEATURES
            </div>
            <div className="text-xs text-slate-500 mt-1">{totalFeatures} live</div>
          </div>

          <nav className="flex-1 overflow-y-auto py-2 px-2">
            {GROUPS.map((g) => {
              const isActive = g.id === activeId
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  className={cn(
                    'relative w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all duration-200 mb-0.5',
                    isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-indicator"
                      className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                      style={{ background: g.accent, boxShadow: `0 0 10px ${g.accent}` }}
                    />
                  )}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: isActive ? `${g.accent}25` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${isActive ? g.accent + '55' : 'rgba(255,255,255,0.08)'}`,
                      boxShadow: isActive ? `0 0 14px ${g.accent}40` : 'none',
                    }}
                  >
                    <g.icon className="w-3.5 h-3.5" style={{ color: isActive ? g.accent : 'rgba(255,255,255,0.45)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[13px] font-semibold tracking-wide"
                      style={{ color: isActive ? 'white' : 'rgba(255,255,255,0.6)' }}
                    >
                      {g.title}
                    </div>
                    <div className="text-[10px] text-slate-500">{g.features.length} features</div>
                  </div>
                </button>
              )
            })}
          </nav>

          <div className="px-5 py-3 border-t border-white/[0.06]">
            <div className="text-[10px] text-slate-600 leading-relaxed">
              <span className="font-mono tracking-wider text-slate-500">↑↓</span> to switch &nbsp;·&nbsp;
              <span className="font-mono tracking-wider text-slate-500">ESC</span> to close
            </div>
          </div>
        </aside>

        {/* Right pane — feature content */}
        <main className="flex-1 flex flex-col min-w-0 relative z-10">
          {/* Close button — top right of pane */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors z-20"
          >
            <X className="w-5 h-5" />
          </button>

          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* Hero */}
              <div className="px-8 pt-8 pb-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-4">
                  <motion.div
                    initial={{ rotate: -8, scale: 0.85 }}
                    animate={{ rotate: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${accent}35, ${accent}10)`,
                      border: `1px solid ${accent}50`,
                      boxShadow: `0 0 30px ${accent}40, inset 0 1px 0 0 rgba(255,255,255,0.1)`,
                    }}
                  >
                    <active.icon className="w-6 h-6" style={{ color: accent }} />
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <h2
                      className="text-3xl font-bold text-white tracking-tight"
                      style={{ textShadow: `0 0 22px ${accent}30` }}
                    >
                      {active.title}
                    </h2>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">{active.tagline}</p>
                  </div>
                </div>
              </div>

              {/* Feature list */}
              <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="space-y-3">
                  {active.features.map((f, i) => {
                    const mat = MATURITY[f.maturity]
                    return (
                      <motion.div
                        key={f.title}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * i, duration: 0.3, ease: 'easeOut' }}
                        className="group relative pl-5 py-3.5 pr-4 rounded-lg border border-white/[0.05] hover:border-white/[0.12] transition-all duration-300"
                        style={{
                          background: 'linear-gradient(90deg, rgba(255,255,255,0.02), transparent)',
                        }}
                      >
                        {/* Accent rail */}
                        <div
                          className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r"
                          style={{
                            background: `linear-gradient(180deg, ${accent}, transparent)`,
                            opacity: 0.6,
                          }}
                        />
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-[15px] font-semibold text-white/95 leading-snug">
                              {f.title}
                            </h3>
                            <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
                              {f.description}
                            </p>
                          </div>
                          <span
                            className="text-[9px] font-bold tracking-[0.2em] px-2 py-0.5 rounded shrink-0 mt-0.5"
                            style={{
                              color: mat.tone,
                              background: `color-mix(in srgb, ${mat.tone} 14%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${mat.tone} 38%, transparent)`,
                            }}
                          >
                            {mat.label}
                          </span>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Footer note — only on Kairos */}
                {active.id === 'kairos' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <Network className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                      <p className="text-[12px] text-slate-400 leading-relaxed">
                        Kairos does no LLM work on the server. Every title and summary is generated by Claude at the call site, then handed to Aeon. Your data, your model, your bill.
                      </p>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </motion.div>
    </div>,
    document.body
  )
}

export function BetaFeaturesButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [unseen, setUnseen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!seen) setUnseen(true)
    } catch {}
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setUnseen(false)
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch {}
  }, [])

  return (
    <>
      <Tooltip label="Features">
        <motion.button
          onClick={() => setIsOpen(true)}
          aria-label="Aeon features"
          className={cn(
            'relative p-2 rounded-xl border transition-all duration-200',
            unseen
              ? 'bg-white/[0.08] border-white/20'
              : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
          )}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            boxShadow: unseen
              ? `0 0 14px ${colors.glowColor}, 0 0 28px ${colors.glowColor}40`
              : glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
          }}
        >
          <FlaskConical className="w-5 h-5 text-current" />
          {unseen && (
            <span
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0c]"
              style={{ backgroundColor: 'var(--primary)' }}
            />
          )}
        </motion.button>
      </Tooltip>

      <BetaFeaturesModal isOpen={isOpen} onClose={handleClose} />
    </>
  )
}

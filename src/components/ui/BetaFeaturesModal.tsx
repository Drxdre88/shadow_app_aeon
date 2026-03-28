'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  X,
  Rocket,
  LayoutGrid,
  Calendar,
  Lightbulb,
  Trophy,
  Terminal,
  BarChart3,
  Download,
  Shield,
  Palette,
  Keyboard,
  GripVertical,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

const BETA_FEATURES = [
  {
    category: 'Core',
    features: [
      { icon: LayoutGrid, title: 'Kanban Board', description: 'Drag-and-drop task management with custom columns, labels, priorities, and dependencies' },
      { icon: Calendar, title: 'Gantt Timeline', description: 'Visual project timeline with task bars, milestones, and dependency arrows' },
      { icon: Lightbulb, title: 'Canvas', description: 'Freeform node-based workspace for brainstorming and architecture diagrams' },
      { icon: Trophy, title: 'Vault (Archive)', description: 'Archive completed work to keep boards clean, restore anytime' },
    ],
  },
  {
    category: 'Dashboard',
    features: [
      { icon: Sparkles, title: 'Project Views', description: 'Grid, Tree, and Space views with drag reorder and group management' },
      { icon: GripVertical, title: 'Drag Reorder', description: 'Reorder projects and groups by dragging, persisted across sessions' },
      { icon: Keyboard, title: 'Shortcuts', description: 'N: new project, E: edit, G: glow color, ?: help, and many more' },
      { icon: Palette, title: 'Themes & Glows', description: 'Customizable color themes, glow effects, and card highlighting' },
    ],
  },
  {
    category: 'Platform',
    features: [
      { icon: Terminal, title: 'MCP Integration', description: 'Claude Code MCP server for AI-driven board management via natural language' },
      { icon: BarChart3, title: 'Usage Stats', description: 'Track your projects, tasks, checklist items, and estimated storage usage' },
      { icon: Download, title: 'Data Export', description: 'Full JSON export of all your data — your data is always yours' },
      { icon: Shield, title: 'Rate-Limited API', description: 'RESTful API with key-based auth for external integrations' },
      { icon: Settings, title: 'Customizable Settings', description: 'Typography, effects, shortcuts, project defaults, and board preferences' },
    ],
  },
]

const STORAGE_KEY = 'aeon-beta-features-seen'

interface BetaFeaturesModalProps {
  isOpen: boolean
  onClose: () => void
}

export function BetaFeaturesModal({ isOpen, onClose }: BetaFeaturesModalProps) {
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-2xl max-h-[85vh] overflow-hidden mx-2 sm:mx-0',
          'rounded-2xl border border-white/[0.12]',
          'flex flex-col relative'
        )}
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor}`,
            '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
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

        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white">Beta Features</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/25">
              Closed Beta
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close beta features"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <p className="text-sm text-slate-400 leading-relaxed">
            Welcome to the Aeon closed beta. Here's everything available to you right now.
            Features are actively evolving — your feedback shapes what comes next.
          </p>

          {BETA_FEATURES.map((group) => (
            <div key={group.category} className="space-y-3">
              <h3
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: colors.primary }}
              >
                {group.category}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.features.map((f) => (
                  <div
                    key={f.title}
                    className="flex gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${colors.primary}20` }}
                    >
                      <f.icon className="w-4 h-4" style={{ color: colors.primary }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{f.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-2">
            <p className="text-xs text-slate-500">
              This is pre-release software. Expect rough edges. Your data is backed up
              and exportable, but schema changes may require migrations during beta.
            </p>
            <p className="text-xs text-slate-500">
              Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono">?</kbd> anytime for help
              or <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono">Cmd+K</kbd> for the command palette.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-all"
            style={{
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.glowColor})`,
              boxShadow: `0 0 ${12 * mult}px ${colors.glowColor}`,
            }}
          >
            Got it
          </motion.button>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export function BetaFeaturesButton() {
  const mounted = useHasMounted()
  const checkedRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  if (mounted && !checkedRef.current) {
    checkedRef.current = true
    try {
      const seen = localStorage.getItem(STORAGE_KEY)
      if (!seen) {
        setIsOpen(true)
        localStorage.setItem(STORAGE_KEY, 'true')
      }
    } catch (e) { if (!(e instanceof DOMException)) console.warn('localStorage:', e) }
  }

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        aria-label="Beta features"
        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        style={{
          boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
        }}
      >
        <Rocket className="w-5 h-5 text-slate-400" />
      </motion.button>

      <BetaFeaturesModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

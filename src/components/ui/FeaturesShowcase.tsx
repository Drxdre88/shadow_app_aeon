'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  X,
  Zap,
  LayoutGrid,
  Calendar,
  Lightbulb,
  Trophy,
  Activity,
  GripVertical,
  Columns3,
  Tags,
  GitBranch,
  Filter,
  Palette,
  Keyboard,
  SquareCheck,
  Archive,
  Terminal,
  BarChart3,
  Download,
  Shield,
  Settings,
  Users,
  Sparkles,
  Clock,
  Layers,
  PenTool,
  Share2,
  TrendingUp,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

type Maturity = 'polished' | 'beta' | 'preview'

const MATURITY_CONFIG: Record<Maturity, { label: string; color: string; bg: string; border: string; glow: string }> = {
  polished: { label: 'Polished', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', glow: 'rgba(52, 211, 153, 0.3)' },
  beta: { label: 'Beta', color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/30', glow: 'rgba(251, 191, 36, 0.3)' },
  preview: { label: 'Preview', color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/30', glow: 'rgba(148, 163, 184, 0.2)' },
}

interface FeatureItem {
  icon: LucideIcon
  title: string
  description: string
}

interface FeatureGroup {
  id: string
  title: string
  subtitle: string
  maturity: Maturity
  accent: string
  features: FeatureItem[]
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'board',
    title: 'Kanban Board',
    subtitle: 'Full-featured task management',
    maturity: 'polished',
    accent: '#8b5cf6',
    features: [
      { icon: GripVertical, title: 'Drag & Drop', description: 'Move tasks between columns, reorder with smooth animations' },
      { icon: Columns3, title: 'Custom Columns', description: 'Create, rename, reorder, delete — right-click for options' },
      { icon: Tags, title: 'Labels & Colors', description: 'Color-coded labels, task glow colors, priority badges' },
      { icon: GitBranch, title: 'Dependencies', description: 'Link tasks with visual arrows, toggle visibility' },
      { icon: Filter, title: 'Filters', description: 'Filter by label, priority, search — combine freely' },
      { icon: SquareCheck, title: 'Checklists', description: 'Grouped checklist items with progress on cards' },
      { icon: Archive, title: 'Vault', description: 'Archive completed work, restore anytime' },
      { icon: Keyboard, title: 'Shortcuts', description: 'C, E, V, L, G, D — keyboard-driven workflow' },
    ],
  },
  {
    id: 'dashboard',
    title: 'Project Dashboard',
    subtitle: 'Multi-project workspace',
    maturity: 'polished',
    accent: '#a78bfa',
    features: [
      { icon: Sparkles, title: 'Three View Modes', description: 'Grid, Tree, and Space views with instant switching' },
      { icon: GripVertical, title: 'Drag Reorder', description: 'Reorder projects and groups, persists across sessions' },
      { icon: Palette, title: 'Themes & Glows', description: 'Custom color themes, glow effects, glassmorphism' },
      { icon: Settings, title: 'Rich Settings', description: 'Typography, effects, shortcuts, board preferences' },
    ],
  },
  {
    id: 'gantt',
    title: 'Gantt Timeline',
    subtitle: 'Visual project scheduling',
    maturity: 'beta',
    accent: '#22d3ee',
    features: [
      { icon: Calendar, title: 'Timeline View', description: 'Drag-resizable task bars with week/month/quarter scale' },
      { icon: Layers, title: 'Row Lanes', description: 'Organize tasks into named swim lanes' },
      { icon: Target, title: 'Milestones', description: 'Mark key dates with diamond milestone markers' },
      { icon: Share2, title: 'Board Sync', description: 'Push tasks to Gantt from board, stays linked' },
    ],
  },
  {
    id: 'velocity',
    title: 'Velocity Analytics',
    subtitle: 'Team performance metrics',
    maturity: 'beta',
    accent: '#f59e0b',
    features: [
      { icon: TrendingUp, title: 'Completion Rate', description: 'Track tasks completed over time' },
      { icon: Clock, title: 'Cycle Time', description: 'Measure how long tasks take from start to done' },
      { icon: Activity, title: 'Burndown', description: 'Visualize remaining work per sprint' },
    ],
  },
  {
    id: 'canvas',
    title: 'Canvas',
    subtitle: 'Freeform visual workspace',
    maturity: 'preview',
    accent: '#94a3b8',
    features: [
      { icon: Lightbulb, title: 'Node Editor', description: 'Create text, image, and link nodes on an infinite canvas' },
      { icon: PenTool, title: 'Connections', description: 'Draw edges between nodes for architecture diagrams' },
    ],
  },
  {
    id: 'platform',
    title: 'Platform',
    subtitle: 'API, integrations, and data',
    maturity: 'polished',
    accent: '#6366f1',
    features: [
      { icon: Terminal, title: 'MCP Server', description: 'Claude Code integration — manage boards via natural language' },
      { icon: Shield, title: 'REST API', description: '28 endpoints with rate limiting and key-based auth' },
      { icon: Download, title: 'Data Export', description: 'Full JSON export — your data is always yours' },
      { icon: BarChart3, title: 'Usage Stats', description: 'Track projects, tasks, storage usage' },
      { icon: Users, title: 'Sharing', description: 'Invite collaborators to projects (schema ready)' },
    ],
  },
]

function FeatureCard({ feature, index, accent }: { feature: FeatureItem; index: number; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.3, ease: 'easeOut' }}
      className="group flex gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-300"
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110"
        style={{ backgroundColor: `${accent}20`, boxShadow: `0 0 12px ${accent}15` }}
      >
        <feature.icon className="w-4 h-4" style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/90">{feature.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{feature.description}</p>
      </div>
    </motion.div>
  )
}

function GroupSection({ group, globalIndex }: { group: FeatureGroup; globalIndex: number }) {
  const mat = MATURITY_CONFIG[group.maturity]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * globalIndex, duration: 0.4, ease: 'easeOut' }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">{group.title}</h3>
          <p className="text-xs text-slate-500">{group.subtitle}</p>
        </div>
        <span className={cn('text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border', mat.bg, mat.border, mat.color)}>
          {mat.label}
        </span>
      </div>

      <div
        className="rounded-xl border border-white/[0.06] p-3 space-y-2"
        style={{ background: `linear-gradient(135deg, ${group.accent}05, transparent)` }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group.features.map((f, i) => (
            <FeatureCard key={f.title} feature={f} index={i} accent={group.accent} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

interface FeaturesShowcaseProps {
  isOpen: boolean
  onClose: () => void
}

export function FeaturesShowcase({ isOpen, onClose }: FeaturesShowcaseProps) {
  const [mounted, setMounted] = useState(false)
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => { setMounted(true) }, [])

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
      className="fixed inset-0 bg-black/75 backdrop-blur-lg flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 60, rotateX: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26, mass: 0.9 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-3xl max-h-[88vh] overflow-hidden mx-2 sm:mx-0',
          'rounded-2xl border border-white/[0.12]',
          'flex flex-col relative'
        )}
        style={{
          background: `linear-gradient(160deg, ${colors.background}f8, ${colors.background}e0, ${colors.background})`,
          boxShadow: [
            `0 0 ${80 * mult}px ${20 * mult}px ${colors.glowColor}`,
            '0 30px 60px -15px rgba(0, 0, 0, 0.85)',
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
          ].join(', '),
        }}
      >
        <div
          className="absolute top-0 left-8 right-8 h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${colors.primary}, ${colors.glowColor}, ${colors.primary}, transparent)`,
            boxShadow: `0 0 ${20 * mult}px ${5 * mult}px ${colors.glowColor}`,
          }}
        />

        <div
          className="absolute top-0 left-0 right-0 h-40 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${colors.glowColor}10, transparent 70%)`,
          }}
        />

        <div className="flex items-center justify-between p-5 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${colors.primary}30, ${colors.glowColor}20)`,
                border: `1px solid ${colors.primary}40`,
                boxShadow: `0 0 20px ${colors.glowColor}30`,
              }}
            >
              <Zap className="w-5 h-5" style={{ color: colors.primary }} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Aeon Features</h2>
              <p className="text-xs text-slate-500">Everything your workspace can do</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close features showcase"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4 px-5 py-3 border-b border-white/[0.06]">
          {Object.entries(MATURITY_CONFIG).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full', val.bg, 'ring-1', val.border)} />
              <span className={cn('text-xs font-medium', val.color)}>{val.label}</span>
            </div>
          ))}
          <div className="flex-1" />
          <span className="text-xs text-slate-600">{FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0)} features</span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 relative z-10">
          {FEATURE_GROUPS.map((group, i) => (
            <GroupSection key={group.id} group={group} globalIndex={i} />
          ))}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center"
          >
            <p className="text-xs text-slate-500">
              Aeon is in closed beta. Features marked <span className="text-amber-400 font-medium">Beta</span> are
              functional but evolving. <span className="text-slate-400 font-medium">Preview</span> features
              are early access — expect rough edges.
            </p>
          </motion.div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end relative z-10">
          <motion.button
            whileHover={{ scale: 1.03, boxShadow: `0 0 ${24 * mult}px ${colors.glowColor}` }}
            whileTap={{ scale: 0.97 }}
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.glowColor})`,
              boxShadow: `0 0 ${16 * mult}px ${colors.glowColor}`,
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

export function FeaturesShowcaseButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Features"
        aria-label="Features showcase"
        style={{
          boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
        }}
      >
        <Zap className="w-5 h-5 text-slate-400" />
      </motion.button>

      <FeaturesShowcase isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

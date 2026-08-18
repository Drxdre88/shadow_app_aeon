'use client'

import { useState, useCallback, useEffect } from 'react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Palette, PenTool, Wand2, Settings, Keyboard, PartyPopper, LayoutGrid, LayoutDashboard, KeyRound, ArrowRight, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { Tooltip } from '../Tooltip'
import { PaletteTab } from './PaletteTab'
import { TypographyTab } from './TypographyTab'
import { EffectsTab } from './EffectsTab'
import { GeneralTab } from './GeneralTab'
import { ShortcutsTab } from './ShortcutsTab'
import { FunTab } from './FunTab'
import { DashboardTab } from './DashboardTab'
import { DefaultsTemplateTab } from './DefaultsTemplateTab'

type SettingsTab = 'projects' | 'board' | 'shortcuts' | 'palette' | 'typography' | 'effects' | 'fun' | 'ai' | 'defaults'

const TAB_CONFIG: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'projects', label: 'Projects', icon: LayoutDashboard },
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'shortcuts', label: 'Keys', icon: Keyboard },
  { id: 'palette', label: 'Theme', icon: Palette },
  { id: 'typography', label: 'Typography', icon: PenTool },
  { id: 'effects', label: 'Effects', icon: Wand2 },
  { id: 'fun', label: 'Fun', icon: PartyPopper },
  { id: 'ai', label: 'AI', icon: KeyRound },
]

const ADMIN_TAB: { id: SettingsTab; label: string; icon: typeof Palette } = { id: 'defaults', label: 'Defaults', icon: ShieldCheck }

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('board')
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'
  const tabs = isAdmin ? [...TAB_CONFIG, ADMIN_TAB] : TAB_CONFIG

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
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
        transition={{
          type: 'spring',
          stiffness: 350,
          damping: 28,
          mass: 0.8,
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-5xl max-h-[85vh] overflow-hidden mx-2 sm:mx-0',
          'rounded-2xl',
          'border border-white/[0.12]',
          'flex flex-col',
          'relative'
        )}
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor}`,
            `0 25px 50px -12px rgba(0, 0, 0, 0.8)`,
            `inset 0 1px 0 0 rgba(255, 255, 255, 0.08)`,
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
            <Settings className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-white/10">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-2 sm:px-4 py-3 text-sm font-medium transition-all duration-200',
                activeTab === id
                  ? 'text-white border-b-2'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'
              )}
              style={
                activeTab === id
                  ? {
                      borderBottomColor: colors.primary,
                      textShadow: `0 0 10px ${colors.glowColor}`,
                    }
                  : {}
              }
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 min-h-[500px]">
          {activeTab === 'board' && <GeneralTab />}
          {activeTab === 'shortcuts' && <ShortcutsTab />}
          {activeTab === 'palette' && <PaletteTab />}
          {activeTab === 'typography' && <TypographyTab />}
          {activeTab === 'effects' && <EffectsTab />}
          {activeTab === 'fun' && <FunTab />}
          {activeTab === 'projects' && <DashboardTab />}
          {activeTab === 'ai' && <AiTab onClose={onClose} />}
          {activeTab === 'defaults' && isAdmin && <DefaultsTemplateTab />}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

function AiTab({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-5 py-6">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: 'color-mix(in oklab, var(--primary) 18%, transparent)',
            boxShadow: '0 0 20px color-mix(in oklab, var(--primary) 30%, transparent)',
          }}
        >
          <KeyRound className="w-5 h-5" style={{ color: 'var(--primary)' }} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">AI integration</h3>
          <p className="text-[12px] text-white/55 mt-0.5">
            Bring your own Anthropic, OpenAI, or Gemini key. Stored encrypted per account.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-2xl">
        <Pillar tone="#f59e0b" label="Anthropic" hint="Claude Opus / Sonnet" />
        <Pillar tone="#10b981" label="OpenAI" hint="GPT-4 / o-series" />
        <Pillar tone="#3b82f6" label="Gemini" hint="Pro / Flash" />
      </div>

      <Link
        href="/settings/ai"
        onClick={onClose}
        className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg border border-white/[0.14] hover:border-white/30 hover:bg-white/[0.04] transition-colors"
        style={{ color: 'var(--primary)' }}
      >
        Open AI integration <ArrowRight className="w-3.5 h-3.5" />
      </Link>

      <p className="text-[11px] text-white/35 max-w-xl leading-relaxed">
        During closed beta this surface is admin-only. Non-admin accounts see a &ldquo;rolling out soon&rdquo; state.
      </p>
    </div>
  )
}

function Pillar({ tone, label, hint }: { tone: string; label: string; hint: string }) {
  return (
    <div
      className="rounded-xl border px-3 py-2.5 flex flex-col gap-0.5"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`,
        background: `color-mix(in oklab, ${tone} 6%, transparent)`,
      }}
    >
      <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: tone }}>{label}</span>
      <span className="text-[11px] text-white/45">{hint}</span>
    </div>
  )
}

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  return (
    <>
      <Tooltip label="Settings">
        <motion.button
          data-settings-trigger
          onClick={() => setIsOpen(true)}
          className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
          }}
        >
          <Settings className="w-5 h-5 text-current" />
        </motion.button>
      </Tooltip>
      <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

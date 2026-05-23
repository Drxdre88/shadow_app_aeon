'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Wrench, BookMarked } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { KairosSetupContent } from './KairosSetupContent'
import { KairosGuideContent } from './KairosGuideContent'

export type KairosLearnTab = 'setup' | 'guide'

const TABS: { id: KairosLearnTab; label: string; icon: typeof Wrench }[] = [
  { id: 'setup', label: 'Setup', icon: Wrench },
  { id: 'guide', label: 'Guide', icon: BookMarked },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultTab?: KairosLearnTab
}

export function KairosLearnModal({ isOpen, onClose, defaultTab = 'setup' }: Props) {
  const [activeTab, setActiveTab] = useState<KairosLearnTab>(defaultTab)
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => { if (isOpen) setActiveTab(defaultTab) }, [isOpen, defaultTab])

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
        transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-4xl max-h-[88vh] overflow-hidden mx-2 sm:mx-0',
          'rounded-2xl border border-white/[0.12] flex flex-col relative',
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
          <div className="flex items-center gap-3">
            <div
              className="text-[10px] font-medium uppercase tracking-[0.32em] px-3 py-1 rounded-full"
              style={{
                color: 'var(--primary)',
                border: '1px solid var(--primary)',
                textShadow: '0 0 6px var(--glow-color)',
                background: 'rgba(8,6,18,0.4)',
              }}
            >
              Kairos 0.1
            </div>
            <h2 className="text-lg font-semibold text-white">Memory · Setup &amp; Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-white/10">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200',
                activeTab === id
                  ? 'text-white border-b-2'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-white/5',
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
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-7 min-h-[500px]">
          {activeTab === 'setup' && <KairosSetupContent />}
          {activeTab === 'guide' && <KairosGuideContent />}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

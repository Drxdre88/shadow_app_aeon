'use client'

import { useState, useCallback, useEffect } from 'react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, HelpCircle, LayoutGrid, Calendar, Lightbulb, Trophy, Terminal, Keyboard } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { Tooltip } from '../Tooltip'
import { BoardTab } from './BoardTab'
import { GanttTab } from './GanttTab'
import { CanvasTab } from './CanvasTab'
import { TrophyTab } from './TrophyTab'
import { McpTab } from './McpTab'
import { ShortcutsHelpTab } from './ShortcutsHelpTab'

type HelpTab = 'board' | 'gantt' | 'canvas' | 'trophy' | 'mcp' | 'shortcuts'

const TAB_CONFIG: { id: HelpTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'gantt', label: 'Gantt', icon: Calendar },
  { id: 'canvas', label: 'Canvas', icon: Lightbulb },
  { id: 'trophy', label: 'Vault', icon: Trophy },
  { id: 'shortcuts', label: 'Keys', icon: Keyboard },
  { id: 'mcp', label: 'MCP', icon: Terminal },
]

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('board')
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
            <HelpCircle className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white">Help</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-white/10">
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
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
          {activeTab === 'board' && <BoardTab />}
          {activeTab === 'gantt' && <GanttTab />}
          {activeTab === 'canvas' && <CanvasTab />}
          {activeTab === 'trophy' && <TrophyTab />}
          {activeTab === 'shortcuts' && <ShortcutsHelpTab />}
          {activeTab === 'mcp' && <McpTab />}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export function HelpButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === '?') {
        e.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <Tooltip label="Help">
        <motion.button
          onClick={() => setIsOpen(true)}
          className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
          }}
        >
          <HelpCircle className="w-5 h-5 text-current" />
        </motion.button>
      </Tooltip>
      <HelpModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
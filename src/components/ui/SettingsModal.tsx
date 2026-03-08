'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Palette, PenTool, Sparkles, Settings } from 'lucide-react'
import { useThemeStore, FONT_OPTIONS, type FontFamily } from '@/stores/themeStore'
import { themes, themeNames, type ThemeName } from '@/config/themes'
import { cn } from '@/lib/utils/cn'

type SettingsTab = 'palette' | 'typography'

const themeLabels: Record<string, string> = Object.fromEntries(
  themeNames.map((name) => [
    name,
    name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
  ])
)

const TAB_CONFIG: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'palette', label: 'Palette', icon: Palette },
  { id: 'typography', label: 'Typography', icon: PenTool },
]

function GlowSlider({
  value,
  onChange,
  themeColor,
  label,
  icon: Icon,
  minLabel = 'Off',
  maxLabel = 'Max',
}: {
  value: number
  onChange: (v: number) => void
  themeColor: string
  label: string
  icon: typeof Sparkles
  minLabel?: string
  maxLabel?: string
}) {
  const [isDragging, setIsDragging] = useState(false)
  const glowOpacity = value / 100

  return (
    <div className="relative py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon
            className="w-4 h-4 transition-all duration-300"
            style={{
              color: themeColor,
              filter: `drop-shadow(0 0 ${8 * glowOpacity}px ${themeColor})`,
            }}
          />
          <span className="text-xs font-medium text-slate-300">{label}</span>
        </div>
        <motion.span
          className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-md"
          style={{
            color: themeColor,
            backgroundColor: `${themeColor}20`,
            boxShadow: value > 50 ? `0 0 ${10 * glowOpacity}px ${themeColor}` : 'none',
          }}
          animate={{ scale: isDragging ? 1.1 : 1 }}
        >
          {value}%
        </motion.span>
      </div>

      <div className="relative h-6 flex items-center">
        <div
          className="absolute inset-x-0 h-1.5 rounded-full overflow-hidden"
          style={{
            background: 'linear-gradient(to right, rgba(255,255,255,0.05), rgba(255,255,255,0.1))',
          }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{
              width: `${value}%`,
              background: `linear-gradient(90deg, ${themeColor}40, ${themeColor})`,
              boxShadow: `0 0 ${20 * glowOpacity}px ${5 * glowOpacity}px ${themeColor}`,
            }}
          />
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          className="absolute inset-x-0 w-full h-6 opacity-0 cursor-pointer z-10"
        />

        <motion.div
          className="absolute w-4 h-4 rounded-full border-2 pointer-events-none"
          style={{
            left: `calc(${value}% - 8px)`,
            background: `radial-gradient(circle at 30% 30%, white, ${themeColor})`,
            borderColor: 'rgba(255,255,255,0.5)',
            boxShadow: `0 0 ${15 * glowOpacity}px ${5 * glowOpacity}px ${themeColor}`,
          }}
          animate={{ scale: isDragging ? 1.3 : 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
      </div>

      <div className="flex justify-between mt-0.5 px-0.5">
        <span className="text-[10px] text-slate-500">{minLabel}</span>
        <span className="text-[10px] text-slate-500">{maxLabel}</span>
      </div>
    </div>
  )
}

function PaletteTab() {
  const {
    currentTheme,
    setTheme,
    glowIntensity,
    setGlowIntensity,
    glassOpacity,
    setGlassOpacity,
    ambientBlobs,
    setAmbientBlobs,
    colors,
  } = useThemeStore()

  const glowMult = glowIntensity / 75

  const themesByCategory = themeNames.reduce<Record<string, string[]>>((acc, name) => {
    const cat = themes[name]?.category ?? 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(name)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Theme</h4>
        {Object.entries(themesByCategory).map(([category, names]) => (
          <div key={category}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">{category}</p>
            <div className="grid grid-cols-3 gap-2">
              {names.map((themeName) => {
                const theme = themes[themeName]
                const isActive = currentTheme === themeName
                return (
                  <motion.button
                    key={themeName}
                    onClick={() => setTheme(themeName as ThemeName)}
                    className={cn(
                      'relative p-3 rounded-lg border transition-all duration-200',
                      'bg-gradient-to-b from-white/5 to-black/20',
                      isActive
                        ? 'border-white/30 ring-2 ring-white/20'
                        : 'border-white/10 hover:border-white/20'
                    )}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    style={
                      isActive
                        ? { boxShadow: `0 0 ${20 * glowMult}px ${3 * glowMult}px ${theme.glowColor}` }
                        : {}
                    }
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                        style={{
                          background: theme.primary,
                          boxShadow: `0 0 ${10 * glowMult}px ${theme.glowColor}`,
                        }}
                      />
                      <span className="text-xs font-medium text-slate-300 truncate">
                        {themeLabels[themeName]}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {theme.chartColors.slice(0, 4).map((color, idx) => (
                        <div
                          key={idx}
                          className="flex-1 h-1.5 rounded-full"
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <GlowSlider
          value={glowIntensity}
          onChange={setGlowIntensity}
          themeColor={colors.glowColor}
          label="Glow Intensity"
          icon={Sparkles}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-md border border-white/20"
                style={{
                  background: `rgba(255,255,255,${glassOpacity / 400})`,
                  backdropFilter: 'blur(4px)',
                }}
              />
              <span className="text-xs font-medium text-slate-300">Glass Transparency</span>
            </div>
            <span
              className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-md"
              style={{
                color: colors.glowColor,
                backgroundColor: `${colors.glowColor}20`,
              }}
            >
              {glassOpacity}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={glassOpacity}
            onChange={(e) => setGlassOpacity(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,0.1) 0%, ${colors.glowColor} ${glassOpacity}%, rgba(255,255,255,0.1) ${glassOpacity}%)`,
            }}
          />
          <div className="flex justify-between mt-1 px-0.5">
            <span className="text-[10px] text-slate-500">Solid</span>
            <span className="text-[10px] text-slate-500">Glass</span>
          </div>
        </div>

        <button
          onClick={() => setAmbientBlobs(!ambientBlobs)}
          className="w-full flex items-center justify-between px-1 py-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{
                background: ambientBlobs ? colors.glowColor : 'rgba(255,255,255,0.1)',
                filter: ambientBlobs ? 'blur(2px)' : 'none',
                boxShadow: ambientBlobs ? `0 0 8px ${colors.glowColor}` : 'none',
              }}
            />
            <span className="text-xs font-medium text-slate-300">Ambient Blobs</span>
          </div>
          <div
            className={cn(
              'w-8 h-[18px] rounded-full transition-colors duration-200 flex items-center px-0.5',
              ambientBlobs ? 'justify-end' : 'justify-start'
            )}
            style={{ background: ambientBlobs ? colors.glowColor : 'rgba(255,255,255,0.1)' }}
          >
            <motion.div
              className="w-3.5 h-3.5 rounded-full bg-white"
              layout
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </div>
        </button>
      </div>
    </div>
  )
}

function TypographyTab() {
  const { fontFamily, setFontFamily, colors } = useThemeStore()

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Font Family</h4>
      <div className="space-y-2">
        {FONT_OPTIONS.map((font) => {
          const isActive = fontFamily === font.id
          return (
            <motion.button
              key={font.id}
              onClick={() => setFontFamily(font.id)}
              className={cn(
                'w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200',
                isActive
                  ? 'border-white/30 bg-white/10'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15'
              )}
              style={
                isActive
                  ? { boxShadow: `0 0 15px 2px ${colors.glowColor}` }
                  : {}
              }
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex flex-col items-start gap-1">
                <span className="text-sm font-medium text-white">{font.label}</span>
                <span
                  className="text-xs text-slate-400"
                  style={{ fontFamily: font.css }}
                >
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
              {isActive && (
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{
                    background: colors.glowColor,
                    boxShadow: `0 0 8px ${colors.glowColor}`,
                  }}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('palette')
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
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50"
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
          'w-full max-w-lg max-h-[80vh] overflow-hidden',
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
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200',
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
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'palette' && <PaletteTab />}
          {activeTab === 'typography' && <TypographyTab />}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        style={{
          boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
        }}
      >
        <Settings className="w-5 h-5 text-slate-400" />
      </motion.button>
      <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

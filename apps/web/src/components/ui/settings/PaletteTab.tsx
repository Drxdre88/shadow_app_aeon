'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronDown, Sparkles, Star } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { themes, themeNames, type ThemeName } from '@/config/themes'
import { cn } from '@/lib/utils/cn'
import { ThemeSlider } from './shared'

const CATEGORY_ORDER = [
  'Standard', 'Vibrant', 'High Contrast', 'Cosmic', 'Warm', 'Nature',
  'Oceanic', 'Pastel', 'Neon / Cyberpunk', 'Minimal', 'Artistic',
  'Moody', 'Exotic', 'Bonus', 'Signature', 'Muted', 'Cinematic', 'Legendary',
]

const themeLabels: Record<string, string> = Object.fromEntries(
  themeNames.map((name) => [
    name,
    name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
  ])
)

function ThemeTile({ themeName, isActive, glowMult, onSelect }: {
  themeName: string
  isActive: boolean
  glowMult: number
  onSelect: () => void
}) {
  const theme = themes[themeName]
  const hasEffect = !!theme.effect

  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        'relative rounded-xl border overflow-hidden transition-all duration-200 text-left',
        isActive
          ? 'border-white/30 ring-2 ring-white/20'
          : 'border-white/[0.08] hover:border-white/20'
      )}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      style={
        isActive
          ? { boxShadow: `0 0 ${24 * glowMult}px ${6 * glowMult}px ${theme.glowColor}` }
          : {}
      }
    >
      <div
        className="h-20 relative"
        style={{
          background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.surface.startsWith('#') ? theme.surface : theme.surface.replace(/[\d.]+\)$/, '1)')} 40%, ${theme.primary}22 100%)`,
        }}
      >
        <div className="absolute inset-0 flex items-end p-2.5">
          <div className="flex gap-[3px]">
            {theme.chartColors.slice(0, 5).map((color, idx) => (
              <div
                key={idx}
                className="w-3.5 h-3.5 rounded-full"
                style={{
                  background: color,
                  boxShadow: `0 0 ${6 * glowMult}px ${color}80`,
                }}
              />
            ))}
          </div>
        </div>

        {hasEffect && (
          <div className="absolute top-2 right-2 z-10">
            <Sparkles className="w-3.5 h-3.5" style={{ color: theme.primary, filter: `drop-shadow(0 0 4px ${theme.glowColor})` }} />
          </div>
        )}

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 80% 20%, ${theme.glowColor}, transparent 60%)`,
            opacity: 0.3,
          }}
        />
      </div>

      <div
        className="px-2.5 py-2 flex items-center gap-2"
        style={{ background: theme.background }}
      >
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{
            background: theme.primary,
            boxShadow: isActive ? `0 0 ${8 * glowMult}px ${theme.glowColor}` : 'none',
          }}
        />
        <span
          className="text-xs font-medium truncate"
          style={{ color: theme.text }}
        >
          {themeLabels[themeName]}
        </span>
        {isActive && <Star className="w-3 h-3 ml-auto flex-shrink-0 fill-current" style={{ color: theme.primary }} />}
      </div>
    </motion.button>
  )
}

function CategorySection({ category, names, currentTheme, glowMult, onSelect, expanded, focused, onToggle, onFocus }: {
  category: string
  names: string[]
  currentTheme: string
  glowMult: number
  onSelect: (name: ThemeName) => void
  expanded: boolean
  focused: boolean
  onToggle: () => void
  onFocus: () => void
}) {
  const hasActive = names.includes(currentTheme)
  const Icon = expanded ? ChevronDown : ChevronRight

  return (
    <div>
      <button
        onClick={() => { onFocus(); onToggle() }}
        onFocus={onFocus}
        className={cn(
          'flex items-center gap-2 w-full text-left px-1 py-1.5 rounded-lg transition-colors group',
          focused ? 'bg-white/[0.06] ring-1 ring-white/10' : 'hover:bg-white/[0.04]'
        )}
      >
        <Icon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{category}</span>
        <span className="text-[10px] text-slate-600 ml-1">{names.length}</span>
        {hasActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-2.5 pt-2 pb-3 px-1">
              {names.map((name) => (
                <ThemeTile
                  key={name}
                  themeName={name}
                  isActive={currentTheme === name}
                  glowMult={glowMult}
                  onSelect={() => onSelect(name as ThemeName)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PaletteTab() {
  const {
    currentTheme, setTheme,
    glowIntensity, setGlowIntensity,
    glassOpacity, setGlassOpacity,
    themeSaturation, setThemeSaturation,
    themeBrightness, setThemeBrightness,
    surfaceVibrancy, setSurfaceVibrancy,
    colors,
  } = useThemeStore()

  const glowMult = glowIntensity / 75

  const defaultCategories = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const name of themeNames) {
      const cat = themes[name]?.category ?? 'Other'
      if (!map[cat]) map[cat] = []
      map[cat].push(name)
    }
    return CATEGORY_ORDER
      .filter((cat) => map[cat]?.length)
      .map((cat) => ({ category: cat, names: map[cat] }))
      .concat(
        Object.entries(map)
          .filter(([cat]) => !CATEGORY_ORDER.includes(cat))
          .map(([category, names]) => ({ category, names }))
      )
  }, [])

  const [categoryOrder, setCategoryOrder] = useState(() => defaultCategories.map((c) => c.category))
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const orderedCategories = useMemo(() => {
    const catMap = Object.fromEntries(defaultCategories.map((c) => [c.category, c]))
    return categoryOrder.filter((cat) => catMap[cat]).map((cat) => catMap[cat])
  }, [categoryOrder, defaultCategories])

  const toggleCollapse = useCallback((category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (focusedIdx < 0) return
    const total = orderedCategories.length

    if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault()
      if (focusedIdx > 0) {
        setCategoryOrder((prev) => {
          const next = [...prev]
          const tmp = next[focusedIdx]
          next[focusedIdx] = next[focusedIdx - 1]
          next[focusedIdx - 1] = tmp
          return next
        })
        setFocusedIdx(focusedIdx - 1)
      }
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault()
      if (focusedIdx < total - 1) {
        setCategoryOrder((prev) => {
          const next = [...prev]
          const tmp = next[focusedIdx]
          next[focusedIdx] = next[focusedIdx + 1]
          next[focusedIdx + 1] = tmp
          return next
        })
        setFocusedIdx(focusedIdx + 1)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx(Math.max(0, focusedIdx - 1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx(Math.min(total - 1, focusedIdx + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const cat = orderedCategories[focusedIdx]?.category
      if (cat && !collapsed.has(cat)) setCollapsed((prev) => new Set(prev).add(cat))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      const cat = orderedCategories[focusedIdx]?.category
      if (cat && collapsed.has(cat)) {
        setCollapsed((prev) => { const n = new Set(prev); n.delete(cat); return n })
      }
    }
  }, [focusedIdx, orderedCategories, collapsed])

  return (
    <div className="space-y-5">
      <div className="space-y-1 max-w-[300px]">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Visual Tuning</h4>
        <ThemeSlider label="Glow Intensity" value={glowIntensity} onChange={setGlowIntensity} min={0} max={100} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Glass Transparency" value={glassOpacity} onChange={setGlassOpacity} min={0} max={100} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Saturation" value={themeSaturation} onChange={setThemeSaturation} min={50} max={200} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Brightness" value={themeBrightness} onChange={setThemeBrightness} min={50} max={150} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Surface Tint" value={surfaceVibrancy} onChange={setSurfaceVibrancy} min={0} max={100} color={colors.glowColor} unit="%" />
      </div>

      <div
        ref={containerRef}
        className="space-y-1 outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => setFocusedIdx(-1)}
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Theme</h4>
          <span className="text-[10px] text-slate-600">Arrow keys navigate, Alt+Arrow reorder, Left/Right collapse</span>
        </div>
        {orderedCategories.map(({ category, names }, idx) => (
          <CategorySection
            key={category}
            category={category}
            names={names}
            currentTheme={currentTheme}
            glowMult={glowMult}
            onSelect={setTheme}
            expanded={!collapsed.has(category)}
            focused={focusedIdx === idx}
            onToggle={() => toggleCollapse(category)}
            onFocus={() => setFocusedIdx(idx)}
          />
        ))}
      </div>
    </div>
  )
}

'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronDown, Sparkles, Star, CheckCircle2, Circle, GripVertical } from 'lucide-react'
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

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '128,128,128'
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`
}

function ThemePreview({ glowMult }: { glowMult: number }) {
  const { colors, currentTheme, glowIntensity, glassOpacity, themeSaturation, themeBrightness, surfaceVibrancy } = useThemeStore()
  const theme = themes[currentTheme]

  const vibrancy = surfaceVibrancy / 100
  const tint = vibrancy > 0 ? `rgba(${hexToRgb(colors.primary)}, ${vibrancy * 0.15})` : 'transparent'
  const satFilter = themeSaturation !== 100 ? `saturate(${themeSaturation}%)` : ''
  const briFilter = themeBrightness !== 100 ? `brightness(${themeBrightness}%)` : ''
  const combinedFilter = [satFilter, briFilter].filter(Boolean).join(' ') || 'none'
  const glassAlpha = (glassOpacity / 100) * 0.12

  const fakeCards = [
    { name: 'Design system tokens', done: true, color: theme.chartColors[0] },
    { name: 'API rate limiting', done: false, color: theme.chartColors[1] },
    { name: 'Dashboard charts', done: false, color: theme.chartColors[2] },
  ]

  return (
    <div
      className="rounded-xl border overflow-hidden transition-all duration-300"
      style={{
        borderColor: `${colors.border}`,
        boxShadow: glowIntensity > 0
          ? `0 0 ${20 * glowMult}px ${4 * glowMult}px ${colors.glowColor}40, inset 0 1px 0 rgba(255,255,255,0.06)`
          : 'inset 0 1px 0 rgba(255,255,255,0.06)',
        filter: combinedFilter,
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 border-b"
        style={{
          background: colors.background,
          borderColor: colors.border,
        }}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: colors.primary, boxShadow: `0 0 ${6 * glowMult}px ${colors.glowColor}` }}
        />
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: colors.text }}>
          {themeLabels[currentTheme]}
        </span>
        <div className="ml-auto flex gap-1">
          {theme.chartColors.slice(0, 5).map((c, i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: c, boxShadow: `0 0 ${4 * glowMult}px ${c}60` }}
            />
          ))}
        </div>
      </div>

      <div
        className="p-3 space-y-2"
        style={{
          background: tint !== 'transparent'
            ? `linear-gradient(180deg, ${tint}, transparent), linear-gradient(180deg, ${colors.background} 0%, ${colors.surface.startsWith('#') ? colors.surface : colors.surface.replace(/[\d.]+\)$/, '1)')} 100%)`
            : `linear-gradient(180deg, ${colors.background} 0%, ${colors.surface.startsWith('#') ? colors.surface : colors.surface.replace(/[\d.]+\)$/, '1)')} 100%)`,
        }}
      >
        <div className="flex gap-2">
          {['In Dev', 'Review', 'Done'].map((col, ci) => (
            <div key={col} className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: theme.chartColors[ci], boxShadow: `0 0 ${4 * glowMult}px ${theme.chartColors[ci]}80` }}
                />
                <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
                  {col}
                </span>
                <span className="text-[8px] ml-auto" style={{ color: colors.textDim }}>
                  {ci === 0 ? 2 : 1}
                </span>
              </div>
              <div className="space-y-1.5">
                {fakeCards
                  .filter((_, idx) => (ci === 0 ? idx < 2 : ci === 1 ? idx === 2 : false))
                  .map((card, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border p-2 transition-all duration-200"
                      style={{
                        background: colors.surface.startsWith('#')
                          ? `rgba(${hexToRgb(colors.surface)}, ${0.6 + glassAlpha})`
                          : colors.surface.replace(/[\d.]+\)$/, `${0.6 + glassAlpha})`),
                        borderColor: colors.border,
                        backdropFilter: glassOpacity > 0 ? `blur(${glassOpacity / 10}px)` : undefined,
                        boxShadow: glowIntensity > 10
                          ? `0 0 ${8 * glowMult}px ${colors.glowColor}15`
                          : undefined,
                      }}
                    >
                      <div className="flex items-start gap-1.5">
                        {card.done ? (
                          <CheckCircle2 className="w-3 h-3 mt-px flex-shrink-0" style={{ color: colors.success }} />
                        ) : (
                          <Circle className="w-3 h-3 mt-px flex-shrink-0" style={{ color: colors.textDim }} />
                        )}
                        <span className="text-[10px] font-medium leading-tight" style={{ color: colors.text }}>
                          {card.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 pl-[18px]">
                        <div
                          className="h-1 rounded-full flex-1"
                          style={{
                            background: `${colors.border}`,
                          }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: card.done ? '100%' : `${40 + idx * 20}%`,
                              background: card.color,
                              boxShadow: `0 0 ${4 * glowMult}px ${card.color}60`,
                            }}
                          />
                        </div>
                        <span className="text-[8px]" style={{ color: colors.textDim }}>
                          {card.done ? '3/3' : `${1 + idx}/3`}
                        </span>
                      </div>
                    </div>
                  ))}
                {ci === 2 && (
                  <div
                    className="rounded-lg border border-dashed p-2 flex items-center justify-center"
                    style={{ borderColor: `${colors.border}`, opacity: 0.5 }}
                  >
                    <span className="text-[9px]" style={{ color: colors.textDim }}>
                      Drop here
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className="rounded-lg border px-2.5 py-1.5 flex items-center gap-2 mt-2"
          style={{
            background: `${colors.primary}10`,
            borderColor: `${colors.primary}30`,
            boxShadow: glowIntensity > 20
              ? `0 0 ${12 * glowMult}px ${colors.glowColor}20`
              : undefined,
          }}
        >
          <GripVertical className="w-3 h-3" style={{ color: colors.textDim }} />
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: colors.border }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: '65%',
                background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent})`,
                boxShadow: `0 0 ${6 * glowMult}px ${colors.glowColor}`,
              }}
            />
          </div>
          <span className="text-[9px] font-medium" style={{ color: colors.primary }}>65%</span>
        </div>
      </div>
    </div>
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
      <div className="flex gap-5 items-start">
        <div className="space-y-1 min-w-[260px] max-w-[300px] flex-shrink-0">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Visual Tuning</h4>
          <ThemeSlider label="Glow Intensity" value={glowIntensity} onChange={setGlowIntensity} min={0} max={100} color={colors.glowColor} unit="%" />
          <ThemeSlider label="Glass Transparency" value={glassOpacity} onChange={setGlassOpacity} min={0} max={100} color={colors.glowColor} unit="%" />
          <ThemeSlider label="Saturation" value={themeSaturation} onChange={setThemeSaturation} min={50} max={200} color={colors.glowColor} unit="%" />
          <ThemeSlider label="Brightness" value={themeBrightness} onChange={setThemeBrightness} min={50} max={150} color={colors.glowColor} unit="%" />
          <ThemeSlider label="Surface Tint" value={surfaceVibrancy} onChange={setSurfaceVibrancy} min={0} max={100} color={colors.glowColor} unit="%" />
        </div>
        <div className="flex-1 min-w-[280px] hidden sm:block">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Live Preview</h4>
          <ThemePreview glowMult={glowMult} />
        </div>
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

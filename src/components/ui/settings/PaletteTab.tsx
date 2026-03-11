'use client'

import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { themes, themeNames, type ThemeName } from '@/config/themes'
import { cn } from '@/lib/utils/cn'
import { GlowSlider, ToggleRow } from './shared'

const themeLabels: Record<string, string> = Object.fromEntries(
  themeNames.map((name) => [
    name,
    name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
  ])
)

export function PaletteTab() {
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
            <div className="grid grid-cols-3 gap-3">
              {names.map((themeName) => {
                const theme = themes[themeName]
                const isActive = currentTheme === themeName
                return (
                  <motion.button
                    key={themeName}
                    onClick={() => setTheme(themeName as ThemeName)}
                    className={cn(
                      'relative p-4 rounded-lg border transition-all duration-200',
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
                        className="w-4 h-4 rounded-full flex-shrink-0"
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
                      {theme.chartColors.slice(0, 5).map((color, idx) => (
                        <div
                          key={idx}
                          className="flex-1 h-2 rounded-full"
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

        <div className="py-1">
          <div className="flex items-center justify-between mb-1.5">
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
            <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ color: colors.glowColor, backgroundColor: `${colors.glowColor}20` }}>
              {glassOpacity}%
            </span>
          </div>
          <div className="relative h-5 flex items-center max-w-[280px]">
            <div className="absolute inset-x-0 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${glassOpacity}%`, background: `linear-gradient(90deg, ${colors.glowColor}60, ${colors.glowColor})` }} />
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={glassOpacity}
              onChange={(e) => setGlassOpacity(Number(e.target.value))}
              className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer z-10"
            />
            <div
              className="absolute w-3 h-3 rounded-full border border-white/40 pointer-events-none"
              style={{ left: `calc(${glassOpacity}% - 6px)`, background: `radial-gradient(circle at 30% 30%, white, ${colors.glowColor})` }}
            />
          </div>
        </div>

        <ToggleRow label="Ambient Blobs" value={ambientBlobs} onChange={setAmbientBlobs} color={colors.glowColor} />
      </div>
    </div>
  )
}

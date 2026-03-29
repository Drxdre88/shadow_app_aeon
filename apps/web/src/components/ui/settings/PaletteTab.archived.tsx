'use client'

import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { themes, themeNames, type ThemeName } from '@/config/themes'
import { cn } from '@/lib/utils/cn'
import { ThemeSlider } from './shared'

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
    themeSaturation,
    setThemeSaturation,
    themeBrightness,
    setThemeBrightness,
    surfaceVibrancy,
    setSurfaceVibrancy,
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

      <div className="space-y-1 max-w-[300px]">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Visual Tuning</h4>
        <ThemeSlider label="Glow Intensity" value={glowIntensity} onChange={setGlowIntensity} min={0} max={100} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Glass Transparency" value={glassOpacity} onChange={setGlassOpacity} min={0} max={100} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Saturation" value={themeSaturation} onChange={setThemeSaturation} min={50} max={200} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Brightness" value={themeBrightness} onChange={setThemeBrightness} min={50} max={150} color={colors.glowColor} unit="%" />
        <ThemeSlider label="Surface Tint" value={surfaceVibrancy} onChange={setSurfaceVibrancy} min={0} max={100} color={colors.glowColor} unit="%" />
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Palette, Sparkles } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { themes, themeNames, type ThemeName } from '@/config/themes'
import { cn } from '@/lib/utils/cn'

const themeLabels: Record<ThemeName, string> = {
  deepSpace: 'Deep Space',
  aurora: 'Aurora',
  ember: 'Ember',
  midnight: 'Midnight',
  forest: 'Forest',
  rose: 'Rose',
}

function GlowSlider({ value, onChange, themeColor }: { value: number; onChange: (v: number) => void; themeColor: string }) {
  const [isDragging, setIsDragging] = useState(false)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value))
  }, [onChange])

  const glowOpacity = value / 100
  const trackGlow = `0 0 ${20 * glowOpacity}px ${5 * glowOpacity}px ${themeColor}`
  const thumbGlow = `0 0 ${30 * glowOpacity}px ${10 * glowOpacity}px ${themeColor}, 0 0 ${60 * glowOpacity}px ${20 * glowOpacity}px ${themeColor}`

  return (
    <div className="relative py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles
            className="w-4 h-4 transition-all duration-300"
            style={{
              color: themeColor,
              filter: `drop-shadow(0 0 ${8 * glowOpacity}px ${themeColor})`,
            }}
          />
          <span className="text-xs font-medium text-slate-300">Glow Intensity</span>
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

      <div className="relative h-8 flex items-center">
        <div
          className="absolute inset-x-0 h-2 rounded-full overflow-hidden"
          style={{
            background: 'linear-gradient(to right, rgba(255,255,255,0.05), rgba(255,255,255,0.1))',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)',
          }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{
              width: `${value}%`,
              background: `linear-gradient(90deg, ${themeColor}40, ${themeColor})`,
              boxShadow: trackGlow,
            }}
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={handleChange}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          className="absolute inset-x-0 w-full h-8 opacity-0 cursor-pointer z-10"
        />

        <motion.div
          className="absolute w-5 h-5 rounded-full border-2 pointer-events-none"
          style={{
            left: `calc(${value}% - 10px)`,
            background: `radial-gradient(circle at 30% 30%, white, ${themeColor})`,
            borderColor: 'rgba(255,255,255,0.5)',
            boxShadow: thumbGlow,
          }}
          animate={{
            scale: isDragging ? 1.3 : 1,
            boxShadow: isDragging ? thumbGlow : `0 0 ${15 * glowOpacity}px ${5 * glowOpacity}px ${themeColor}`,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />

        {value > 20 && (
          <motion.div
            className="absolute h-1 rounded-full pointer-events-none"
            style={{
              left: '0',
              width: `${value}%`,
              background: `linear-gradient(90deg, transparent, ${themeColor}60)`,
              filter: `blur(${4 * glowOpacity}px)`,
            }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      <div className="flex justify-between mt-1 px-0.5">
        <span className="text-[10px] text-slate-500">Off</span>
        <span className="text-[10px] text-slate-500">Subtle</span>
        <span className="text-[10px] text-slate-500">Max</span>
      </div>
    </div>
  )
}

export function ThemeSelector() {
  const { currentTheme, setTheme, glowIntensity, setGlowIntensity, colors } = useThemeStore()

  return (
    <div className="relative group">
      <motion.button
        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        style={{
          boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
        }}
      >
        <Palette className="w-5 h-5 text-slate-400" />
      </motion.button>

      <div className="absolute right-0 top-full mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
        <motion.div
          className="p-4 min-w-[300px] rounded-xl border border-white/10 bg-[#1a1a2e] shadow-2xl"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <h3 className="text-sm font-medium text-slate-300 mb-3">Theme</h3>
          <div className="grid grid-cols-2 gap-2">
            {themeNames.map((themeName) => {
              const theme = themes[themeName]
              const isActive = currentTheme === themeName
              const glowMult = glowIntensity / 75

              return (
                <motion.button
                  key={themeName}
                  onClick={() => setTheme(themeName)}
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
                      ? {
                          boxShadow: `0 0 ${20 * glowMult}px ${3 * glowMult}px ${theme.glowColor}`,
                        }
                      : {}
                  }
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{
                        background: theme.primary,
                        boxShadow: `0 0 ${10 * glowMult}px ${theme.glowColor}`,
                      }}
                    />
                    <span className="text-xs font-medium text-slate-300">
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

          <div className="mt-4 pt-4 border-t border-white/10">
            <GlowSlider
              value={glowIntensity}
              onChange={setGlowIntensity}
              themeColor={colors.glowColor}
            />
          </div>
        </motion.div>
      </div>
    </div>
  )
}

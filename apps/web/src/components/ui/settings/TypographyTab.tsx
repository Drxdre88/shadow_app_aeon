'use client'

import { motion } from 'framer-motion'
import { useThemeStore, FONT_OPTIONS } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

export function TypographyTab() {
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

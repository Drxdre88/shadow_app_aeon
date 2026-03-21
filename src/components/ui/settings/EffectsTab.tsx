'use client'

import { motion } from 'framer-motion'
import { useThemeStore, type DepLineStyle, type DepViewMode } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { CompactSlider } from './shared'

const DEP_LINE_STYLE_OPTIONS: { id: DepLineStyle; name: string }[] = [
  { id: 'solid', name: 'Solid' },
  { id: 'dashed', name: 'Dashed' },
  { id: 'dotted', name: 'Dotted' },
]

const DEP_VIEW_MODE_OPTIONS: { id: DepViewMode; name: string }[] = [
  { id: 'canvas', name: 'Bubbles' },
  { id: 'arrows', name: 'Arrows' },
]

export function EffectsTab() {
  const { depLineWidth, setDepLineWidth, depLineGlow, setDepLineGlow, depLineStyle, setDepLineStyle, depCanvasBlur, setDepCanvasBlur, depViewMode, setDepViewMode, colors, glowIntensity } = useThemeStore()
  const glowMult = glowIntensity / 75

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Dependencies</h4>
        <div className="flex gap-2 mb-3">
          {DEP_VIEW_MODE_OPTIONS.map(({ id, name }) => {
            const isActive = depViewMode === id
            return (
              <motion.button
                key={id}
                onClick={() => setDepViewMode(id)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border',
                  isActive
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:border-white/15 hover:text-slate-300'
                )}
                style={isActive ? { boxShadow: `0 0 ${15 * glowMult}px 2px ${colors.glowColor}` } : {}}
                whileTap={{ scale: 0.98 }}
              >
                {name}
              </motion.button>
            )
          })}
        </div>

        {depViewMode === 'arrows' && (
          <>
            <div className="space-y-2 max-w-md">
              <CompactSlider label="Line Width" value={depLineWidth} onChange={setDepLineWidth} min={0.3} max={3} step={0.1} color={colors.glowColor} unit="px" />
              <CompactSlider label="Glow Brightness" value={depLineGlow} onChange={setDepLineGlow} min={0} max={100} color={colors.glowColor} unit="%" />
            </div>
            <div className="flex gap-2">
              {DEP_LINE_STYLE_OPTIONS.map(({ id, name }) => {
                const isActive = depLineStyle === id
                return (
                  <motion.button
                    key={id}
                    onClick={() => setDepLineStyle(id)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border',
                      isActive
                        ? 'border-white/30 bg-white/10 text-white'
                        : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:border-white/15 hover:text-slate-300'
                    )}
                    style={isActive ? { boxShadow: `0 0 ${15 * glowMult}px 2px ${colors.glowColor}` } : {}}
                    whileTap={{ scale: 0.98 }}
                  >
                    {name}
                  </motion.button>
                )
              })}
            </div>
          </>
        )}

        <div className="space-y-2 max-w-md">
          <CompactSlider label="Canvas Backdrop Blur" value={depCanvasBlur} onChange={setDepCanvasBlur} min={0} max={40} color={colors.glowColor} unit="px" />
        </div>
      </div>
    </div>
  )
}

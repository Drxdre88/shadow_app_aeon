'use client'

import { motion } from 'framer-motion'
import { Sparkles, Ghost, Zap } from 'lucide-react'
import { useThemeStore, type DragEffect, type CursorEffect, type DepLineStyle } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { CompactSlider } from './shared'

const DRAG_EFFECT_OPTIONS: { id: DragEffect; name: string; icon: typeof Sparkles }[] = [
  { id: 'glow', name: 'Aurora Glow', icon: Sparkles },
  { id: 'ghost', name: 'Ghost Trail', icon: Ghost },
  { id: 'lightning', name: 'Lightning', icon: Zap },
]

const CURSOR_EFFECT_OPTIONS: { id: CursorEffect; name: string }[] = [
  { id: 'none', name: 'Off' },
  { id: 'glow', name: 'Glow Follower' },
  { id: 'particles', name: 'Particle Trail' },
  { id: 'trail', name: 'Ribbon Trail' },
  { id: 'neon', name: 'Neon Line' },
  { id: 'combo', name: 'Combo' },
  { id: 'fire', name: 'Inferno' },
  { id: 'ice', name: 'Frost Shards' },
  { id: 'portal', name: 'Vortex' },
  { id: 'venom', name: 'Venom' },
  { id: 'plasma', name: 'Plasma' },
  { id: 'blood-moon', name: 'Blood Moon' },
  { id: 'smoke', name: 'Dark Smoke' },
  { id: 'inferno-smoke', name: 'Inferno Smoke' },
  { id: 'venom-smoke', name: 'Venom Smoke' },
  { id: 'plasma-smoke', name: 'Plasma Smoke' },
  { id: 'blood-moon-smoke', name: 'Blood Moon Smoke' },
  { id: 'custom-smoke', name: 'Custom Smoke' },
]

const DEP_LINE_STYLE_OPTIONS: { id: DepLineStyle; name: string }[] = [
  { id: 'solid', name: 'Solid' },
  { id: 'dashed', name: 'Dashed' },
  { id: 'dotted', name: 'Dotted' },
]

export function EffectsTab() {
  const { dragEffect, setDragEffect, cursorEffect, setCursorEffect, cursorColor, setCursorColor, smokeVolume, setSmokeVolume, depLineWidth, setDepLineWidth, depLineGlow, setDepLineGlow, depLineStyle, setDepLineStyle, colors, glowIntensity } = useThemeStore()
  const isSmokeEffect = cursorEffect.includes('smoke')
  const glowMult = glowIntensity / 75

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Drag Effect</h4>
        <div className="flex gap-2">
          {DRAG_EFFECT_OPTIONS.map(({ id, name, icon: Icon }) => {
            const isActive = dragEffect === id
            return (
              <motion.button
                key={id}
                onClick={() => setDragEffect(id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border',
                  isActive
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:border-white/15 hover:text-slate-300'
                )}
                style={isActive ? { boxShadow: `0 0 ${15 * glowMult}px 2px ${colors.glowColor}` } : {}}
                whileTap={{ scale: 0.98 }}
              >
                <Icon className="w-4 h-4" />
                {name}
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Cursor Effect</h4>
        <div className="flex flex-wrap gap-2">
          {CURSOR_EFFECT_OPTIONS.map(({ id, name }) => {
            const isActive = cursorEffect === id
            return (
              <motion.button
                key={id}
                onClick={() => setCursorEffect(id)}
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
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs text-slate-400">Cursor Color</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCursorColor('')}
              className={cn(
                'px-2 py-1 rounded-md text-xs transition-all border',
                !cursorColor
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'
              )}
            >
              Theme
            </button>
            <label className="relative cursor-pointer">
              <input
                type="color"
                value={cursorColor || colors.glowColor}
                onChange={(e) => setCursorColor(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div
                className={cn(
                  'w-7 h-7 rounded-full border-2 transition-all',
                  cursorColor ? 'border-white' : 'border-white/30 hover:border-white/50'
                )}
                style={{ backgroundColor: cursorColor || colors.glowColor }}
              />
            </label>
          </div>
        </div>
        {isSmokeEffect && (
          <div className="max-w-md mt-2">
            <CompactSlider label="Smoke Volume" value={smokeVolume} onChange={setSmokeVolume} min={0} max={100} color={colors.glowColor} unit="%" />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Dependency Lines</h4>
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
      </div>
    </div>
  )
}

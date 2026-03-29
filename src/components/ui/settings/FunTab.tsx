'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Ghost, Zap, ChevronRight, Trophy } from 'lucide-react'
import { useThemeStore, type DragEffect, type CursorEffect } from '@/stores/themeStore'
import type { CelebrationStyle } from '@/components/celebrations/types'
import { cn } from '@/lib/utils/cn'
import { ToggleRow, ThemeSlider } from './shared'
import { triggerCelebration } from '@/components/celebrations/CelebrationEngine'

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

const CELEBRATION_OPTIONS: { category: string; styles: { id: CelebrationStyle; name: string }[] }[] = [
  { category: 'Business', styles: [
    { id: 'checkmark-pulse', name: 'Checkmark Pulse' },
    { id: 'stock-rise', name: 'Stock Rise' },
    { id: 'rubber-stamp', name: 'Rubber Stamp' },
    { id: 'gold-seal', name: 'Gold Seal' },
    { id: 'briefcase-snap', name: 'Briefcase Snap' },
  ]},
  { category: 'Fun', styles: [
    { id: 'confetti-burst', name: 'Confetti Burst' },
    { id: 'fireworks', name: 'Fireworks' },
    { id: 'balloon-rise', name: 'Balloon Rise' },
    { id: 'party-popper', name: 'Party Popper' },
    { id: 'star-explosion', name: 'Star Explosion' },
  ]},
  { category: 'Alien', styles: [
    { id: 'abduction-beam', name: 'Abduction Beam' },
    { id: 'acid-dissolve', name: 'Acid Dissolve' },
    { id: 'warp-drive', name: 'Warp Drive' },
    { id: 'plasma-rift', name: 'Plasma Rift' },
    { id: 'portal-vortex', name: 'Portal Vortex' },
  ]},
  { category: 'Medieval', styles: [
    { id: 'transmutation', name: 'Transmutation' },
    { id: 'sword-slash', name: 'Sword Slash' },
    { id: 'dragon-fire', name: 'Dragon Fire' },
    { id: 'potion-complete', name: 'Potion Complete' },
    { id: 'scroll-seal', name: 'Scroll Seal' },
  ]},
]

export function FunTab() {
  const {
    dragEffect, setDragEffect,
    cursorEffect, setCursorEffect,
    cursorColor, setCursorColor,
    smokeVolume, setSmokeVolume,
    ambientBlobs, setAmbientBlobs,
    spacePlanetGlow, setSpacePlanetGlow,
    spaceOrbitSpeed, setSpaceOrbitSpeed,
    celebrationStyle, setCelebrationStyle,
    colors, glowIntensity,
  } = useThemeStore()
  const isSmokeEffect = cursorEffect.includes('smoke')
  const glowMult = glowIntensity / 75
  const [expandedCat, setExpandedCat] = useState<string | null>(
    CELEBRATION_OPTIONS.find((c) => c.styles.some((s) => s.id === celebrationStyle))?.category ?? null
  )

  const handlePreview = (styleId: CelebrationStyle) => {
    const prev = celebrationStyle
    setCelebrationStyle(styleId)
    setTimeout(() => triggerCelebration(window.innerWidth / 2, window.innerHeight / 2), 50)
    if (styleId !== prev) return
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-slate-400" />
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Task Complete Celebration</h4>
        </div>

        <motion.button
          onClick={() => setCelebrationStyle('none')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border',
            celebrationStyle === 'none'
              ? 'border-white/30 bg-white/10 text-white'
              : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06]'
          )}
          whileTap={{ scale: 0.98 }}
        >
          Off
        </motion.button>

        {CELEBRATION_OPTIONS.map(({ category, styles }) => {
          const isExpanded = expandedCat === category
          const hasActive = styles.some((s) => s.id === celebrationStyle)
          return (
            <div key={category}>
              <button
                onClick={() => setExpandedCat(isExpanded ? null : category)}
                className="flex items-center gap-2 w-full text-left px-1 py-1 rounded-lg hover:bg-white/[0.04] transition-colors group"
              >
                <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
                </motion.div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{category}</span>
                {hasActive && <div className="w-1.5 h-1.5 rounded-full ml-1" style={{ background: colors.primary }} />}
              </button>
              {isExpanded && (
                <div className="flex flex-wrap gap-2 pt-1.5 pb-2 pl-5">
                  {styles.map(({ id, name }) => {
                    const isActive = celebrationStyle === id
                    return (
                      <motion.button
                        key={id}
                        onClick={() => handlePreview(id)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border',
                          isActive
                            ? 'border-white/30 bg-white/10 text-white'
                            : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-slate-300'
                        )}
                        style={isActive ? { boxShadow: `0 0 ${12 * glowMult}px 2px ${colors.glowColor}` } : {}}
                        whileTap={{ scale: 0.95 }}
                      >
                        {name}
                      </motion.button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

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
          <div className="max-w-[300px] mt-2">
            <ThemeSlider label="Smoke Volume" value={smokeVolume} onChange={setSmokeVolume} min={0} max={100} color={colors.glowColor} unit="%" />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Space View</h4>
        <ToggleRow label="Planet Glow Border" value={spacePlanetGlow} onChange={setSpacePlanetGlow} color={colors.glowColor} />
        <div>
          <span className="text-xs text-slate-400 block mb-1.5">Planet Orbit Speed</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5].map((v) => {
              const isActive = spaceOrbitSpeed === v
              return (
                <motion.button
                  key={v}
                  onClick={() => setSpaceOrbitSpeed(v)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all border',
                    isActive
                      ? 'border-white/30 bg-white/10 text-white'
                      : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06]'
                  )}
                  style={isActive ? { boxShadow: `0 0 ${10 * glowMult}px 1px ${colors.glowColor}` } : {}}
                  whileTap={{ scale: 0.95 }}
                >
                  {v === 0 ? 'Off' : v}
                </motion.button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Ambient</h4>
        <ToggleRow label="Ambient Blobs" value={ambientBlobs} onChange={setAmbientBlobs} color={colors.glowColor} />
      </div>
    </div>
  )
}

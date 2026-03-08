'use client'

import { useThemeStore } from '@/stores/themeStore'

export function MatrixEffect() {
  const { colors } = useThemeStore()

  return (
    <div className="fixed inset-0 pointer-events-none z-[1]">
      <div
        className="absolute inset-0"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            ${colors.glowColor.replace(/[\d.]+\)$/, '0.03)')} 2px,
            ${colors.glowColor.replace(/[\d.]+\)$/, '0.03)')} 4px
          )`,
        }}
      />
      <div
        className="absolute inset-0 animate-pulse"
        style={{
          background: `radial-gradient(ellipse at center, ${colors.glowColor.replace(/[\d.]+\)$/, '0.05)')} 0%, transparent 70%)`,
          animationDuration: '4s',
        }}
      />
    </div>
  )
}

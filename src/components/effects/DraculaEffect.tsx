'use client'

import { useThemeStore } from '@/stores/themeStore'

export function DraculaEffect() {
  const { colors } = useThemeStore()

  return (
    <div className="fixed inset-0 pointer-events-none z-[1]">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, transparent 50%, ${colors.glowColor.replace(/[\d.]+\)$/, '0.12)')} 100%)`,
        }}
      />
    </div>
  )
}

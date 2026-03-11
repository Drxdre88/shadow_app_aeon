'use client'

import { useThemeStore } from '@/stores/themeStore'
import { themes } from '@/config/themes'
import { MatrixEffect } from './MatrixEffect'
import { VulcanEffect } from './VulcanEffect'
import { DraculaEffect } from './DraculaEffect'

export function ThemeEffects() {
  const { currentTheme } = useThemeStore()
  const theme = themes[currentTheme]

  if (!theme?.effect) return null

  switch (theme.effect) {
    case 'matrix': return <MatrixEffect />
    case 'matrix-unleashed': return <MatrixEffect />
    case 'vulcan': return <VulcanEffect />
    case 'dracula': return <DraculaEffect />
    default: return null
  }
}

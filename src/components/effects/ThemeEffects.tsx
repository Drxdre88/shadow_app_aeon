'use client'

import { useThemeStore } from '@/stores/themeStore'
import { themes } from '@/config/themes'
import { MatrixEffect } from './MatrixEffect'
import { VulcanEffect } from './VulcanEffect'
import { DraculaEffect } from './DraculaEffect'
import { SnowfallEffect } from './SnowfallEffect'
import { StormEffect } from './StormEffect'
import { InfernoEffect } from './InfernoEffect'
import { AuroraBorealisEffect } from './AuroraBorealisEffect'
import { SakuraEffect } from './SakuraEffect'
import { StarfieldEffect } from './StarfieldEffect'
import { FireflyEffect } from './FireflyEffect'
import { DeepSeaEffect } from './DeepSeaEffect'

export function ThemeEffects() {
  const { currentTheme } = useThemeStore()
  const theme = themes[currentTheme]

  if (!theme?.effect) return null

  switch (theme.effect) {
    case 'matrix': return <MatrixEffect />
    case 'matrix-unleashed': return <MatrixEffect />
    case 'vulcan': return <VulcanEffect />
    case 'dracula': return <DraculaEffect />
    case 'snowfall': return <SnowfallEffect />
    case 'storm': return <StormEffect />
    case 'inferno': return <InfernoEffect />
    case 'aurora-borealis': return <AuroraBorealisEffect />
    case 'sakura': return <SakuraEffect />
    case 'starfield': return <StarfieldEffect />
    case 'firefly': return <FireflyEffect />
    case 'deep-sea': return <DeepSeaEffect />
    default: return null
  }
}

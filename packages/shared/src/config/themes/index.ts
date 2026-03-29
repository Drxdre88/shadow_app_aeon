export type { ThemeColors } from './types'
import type { ThemeColors } from './types'
import { standardThemes } from './standard'
import { mutedThemes } from './muted'
import { highContrastThemes } from './highContrast'
import { vibrantThemes } from './vibrant'
import { cinematicThemes } from './cinematic'
import { cosmicThemes } from './cosmic'
import { warmThemes } from './warm'
import { natureThemes } from './nature'
import { oceanicThemes } from './oceanic'
import { pastelThemes } from './pastel'
import { neonCyberpunkThemes } from './neonCyberpunk'
import { minimalThemes } from './minimal'
import { artisticThemes } from './artistic'
import { moodyThemes } from './moody'
import { exoticThemes } from './exotic'
import { bonusThemes } from './bonus'
import { signatureThemes } from './signature'

export const themes: Record<string, ThemeColors> = {
  ...standardThemes,
  ...mutedThemes,
  ...highContrastThemes,
  ...vibrantThemes,
  ...cinematicThemes,
  ...cosmicThemes,
  ...warmThemes,
  ...natureThemes,
  ...oceanicThemes,
  ...pastelThemes,
  ...neonCyberpunkThemes,
  ...minimalThemes,
  ...artisticThemes,
  ...moodyThemes,
  ...exoticThemes,
  ...bonusThemes,
  ...signatureThemes,
}

export const themeNames = Object.keys(themes)
export type ThemeName = keyof typeof themes

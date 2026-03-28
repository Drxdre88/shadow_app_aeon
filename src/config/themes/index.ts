export type { ThemeColors } from './types'
export { standardThemes } from './standard'
export { mutedThemes } from './muted'
export { highContrastThemes } from './highContrast'
export { vibrantThemes } from './vibrant'
export { cinematicThemes } from './cinematic'
export { cosmicThemes } from './cosmic'
export { warmThemes } from './warm'
export { natureThemes } from './nature'
export { oceanicThemes } from './oceanic'
export { pastelThemes } from './pastel'
export { neonCyberpunkThemes } from './neonCyberpunk'
export { minimalThemes } from './minimal'
export { artisticThemes } from './artistic'
export { moodyThemes } from './moody'
export { exoticThemes } from './exotic'
export { bonusThemes } from './bonus'
export { signatureThemes } from './signature'

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
import type { ThemeColors } from './types'

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

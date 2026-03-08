export type { ThemeColors } from './types'
export { standardThemes } from './standard'
export { mutedThemes } from './muted'
export { highContrastThemes } from './highContrast'
export { vibrantThemes } from './vibrant'
export { cinematicThemes } from './cinematic'

import { standardThemes } from './standard'
import { mutedThemes } from './muted'
import { highContrastThemes } from './highContrast'
import { vibrantThemes } from './vibrant'
import { cinematicThemes } from './cinematic'
import type { ThemeColors } from './types'

export const themes: Record<string, ThemeColors> = {
  ...standardThemes,
  ...mutedThemes,
  ...highContrastThemes,
  ...vibrantThemes,
  ...cinematicThemes,
}

export const themeNames = Object.keys(themes)
export type ThemeName = keyof typeof themes

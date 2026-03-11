export interface ThemeColors {
  background: string
  surface: string
  surfaceHover: string
  border: string
  borderHover: string
  text: string
  textMuted: string
  textDim: string
  primary: string
  primaryHover: string
  primaryMuted: string
  accent: string
  success: string
  warning: string
  error: string
  glow: string
  glowColor: string
  chartColors: string[]
  isDark: boolean
  effect?: 'matrix' | 'matrix-unleashed' | 'vulcan' | 'dracula'
  category?: string
}

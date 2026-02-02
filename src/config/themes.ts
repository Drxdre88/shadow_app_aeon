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
}

export const themes: Record<string, ThemeColors> = {
  deepSpace: {
    background: '#0a0a0f',
    surface: 'rgba(15, 15, 25, 0.8)',
    surfaceHover: 'rgba(20, 20, 35, 0.9)',
    border: 'rgba(139, 92, 246, 0.2)',
    borderHover: 'rgba(139, 92, 246, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#8b5cf6',
    primaryHover: '#a78bfa',
    primaryMuted: 'rgba(139, 92, 246, 0.2)',
    accent: '#c084fc',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(139, 92, 246, 0.6)',
    glowColor: 'rgba(139, 92, 246, 0.5)',
    chartColors: ['#8b5cf6', '#c084fc', '#a78bfa', '#ddd6fe', '#e9d5ff'],
    isDark: true,
  },
  aurora: {
    background: '#0a0f14',
    surface: 'rgba(10, 25, 35, 0.8)',
    surfaceHover: 'rgba(15, 30, 45, 0.9)',
    border: 'rgba(34, 211, 238, 0.2)',
    borderHover: 'rgba(34, 211, 238, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#22d3ee',
    primaryHover: '#67e8f9',
    primaryMuted: 'rgba(34, 211, 238, 0.2)',
    accent: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(34, 211, 238, 0.6)',
    glowColor: 'rgba(34, 211, 238, 0.5)',
    chartColors: ['#22d3ee', '#67e8f9', '#06b6d4', '#a5f3fc', '#cffafe'],
    isDark: true,
  },
  ember: {
    background: '#0f0a08',
    surface: 'rgba(25, 15, 10, 0.8)',
    surfaceHover: 'rgba(35, 20, 15, 0.9)',
    border: 'rgba(249, 115, 22, 0.2)',
    borderHover: 'rgba(249, 115, 22, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#f97316',
    primaryHover: '#fb923c',
    primaryMuted: 'rgba(249, 115, 22, 0.2)',
    accent: '#ea580c',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(249, 115, 22, 0.6)',
    glowColor: 'rgba(249, 115, 22, 0.5)',
    chartColors: ['#f97316', '#fb923c', '#ea580c', '#fdba74', '#fed7aa'],
    isDark: true,
  },
  midnight: {
    background: '#0a0e14',
    surface: 'rgba(10, 15, 30, 0.8)',
    surfaceHover: 'rgba(15, 25, 45, 0.9)',
    border: 'rgba(59, 130, 246, 0.2)',
    borderHover: 'rgba(59, 130, 246, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    primaryMuted: 'rgba(59, 130, 246, 0.2)',
    accent: '#2563eb',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(59, 130, 246, 0.6)',
    glowColor: 'rgba(59, 130, 246, 0.5)',
    chartColors: ['#3b82f6', '#60a5fa', '#2563eb', '#93c5fd', '#bfdbfe'],
    isDark: true,
  },
  forest: {
    background: '#0a0f0a',
    surface: 'rgba(10, 20, 15, 0.8)',
    surfaceHover: 'rgba(15, 30, 25, 0.9)',
    border: 'rgba(16, 185, 129, 0.2)',
    borderHover: 'rgba(16, 185, 129, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#10b981',
    primaryHover: '#34d399',
    primaryMuted: 'rgba(16, 185, 129, 0.2)',
    accent: '#059669',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(16, 185, 129, 0.6)',
    glowColor: 'rgba(16, 185, 129, 0.5)',
    chartColors: ['#10b981', '#34d399', '#059669', '#6ee7b7', '#a7f3d0'],
    isDark: true,
  },
  rose: {
    background: '#0f0a0e',
    surface: 'rgba(25, 10, 20, 0.8)',
    surfaceHover: 'rgba(35, 15, 30, 0.9)',
    border: 'rgba(236, 72, 153, 0.2)',
    borderHover: 'rgba(236, 72, 153, 0.4)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    primary: '#ec4899',
    primaryHover: '#f472b6',
    primaryMuted: 'rgba(236, 72, 153, 0.2)',
    accent: '#db2777',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    glow: '0 0 30px 8px rgba(236, 72, 153, 0.6)',
    glowColor: 'rgba(236, 72, 153, 0.5)',
    chartColors: ['#ec4899', '#f472b6', '#db2777', '#f9a8d4', '#fbcfe8'],
    isDark: true,
  },
}

export const themeNames = Object.keys(themes)
export type ThemeName = keyof typeof themes

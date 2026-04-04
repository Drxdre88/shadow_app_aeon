export type FontFamily = 'system' | 'inter' | 'jetbrains' | 'space-grotesk' | 'fira-code'
export type DragEffect = 'glow' | 'ghost' | 'lightning'
export type DepLineStyle = 'solid' | 'dashed' | 'dotted'
export type DepViewMode = 'canvas' | 'arrows'
export type CursorEffect = 'none' | 'glow' | 'particles' | 'combo' | 'trail' | 'neon' | 'fire' | 'ice' | 'portal' | 'venom' | 'plasma' | 'blood-moon' | 'smoke' | 'inferno-smoke' | 'venom-smoke' | 'plasma-smoke' | 'blood-moon-smoke' | 'custom-smoke'
export type GlowSource = 'manual' | 'priority' | 'first-label' | 'column'
export type BoardLayout = 'scroll' | 'grid'
export type CompletionMode = 'done' | 'vault'
export type ProjectViewMode = 'grid' | 'tree' | 'space'
export type ProjectSortMode = 'alphabetical' | 'custom'

export interface CustomPriority {
  id: string
  name: string
  color: string
}

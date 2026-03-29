export interface CelebrationContext {
  ctx: CanvasRenderingContext2D
  originX: number
  originY: number
  width: number
  height: number
  elapsed: number
  duration: number
  progress: number
  themeColor: string
  glowColor: string
}

export interface CelebrationAnimation {
  id: string
  name: string
  category: 'business' | 'fun' | 'horror' | 'alien' | 'medieval'
  duration: number
  render: (ctx: CelebrationContext) => void
}

export const CELEBRATION_CATEGORIES = [
  { id: 'business', label: 'Business', icon: 'Briefcase' },
  { id: 'fun', label: 'Fun', icon: 'PartyPopper' },
  { id: 'horror', label: 'Horror', icon: 'Skull' },
  { id: 'alien', label: 'Alien', icon: 'Zap' },
  { id: 'medieval', label: 'Medieval', icon: 'Sword' },
] as const

export type CelebrationStyle =
  | 'none'
  | 'checkmark-pulse' | 'stock-rise' | 'rubber-stamp' | 'gold-seal' | 'briefcase-snap'
  | 'confetti-burst' | 'fireworks' | 'balloon-rise' | 'party-popper' | 'star-explosion'
  | 'abduction-beam' | 'acid-dissolve' | 'warp-drive' | 'plasma-rift' | 'portal-vortex'
  | 'transmutation' | 'sword-slash' | 'dragon-fire' | 'potion-complete' | 'scroll-seal'

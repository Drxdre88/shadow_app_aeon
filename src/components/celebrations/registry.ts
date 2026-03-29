import type { CelebrationAnimation, CelebrationStyle } from './types'

export const celebrationRegistry: Partial<Record<CelebrationStyle, CelebrationAnimation>> = {}

export function registerCelebration(animation: CelebrationAnimation) {
  celebrationRegistry[animation.id as CelebrationStyle] = animation
}

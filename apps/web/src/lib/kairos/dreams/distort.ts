import { fnv1a32 } from './fingerprint'

// Each picked memory is bent one way, chosen by code, never by the model. The
// rotation starts at a date-hashed offset so the same memory order still
// distorts differently night to night, and identically on a re-plan.
export const DREAM_DISTORTIONS = ['swap_who', 'flip_outcome', 'move_setting', 'compress_time'] as const
export type DreamDistortion = (typeof DREAM_DISTORTIONS)[number]

export const DISTORTION_GUIDE: Record<DreamDistortion, string> = {
  swap_who: 'someone else is in it (swap who did or felt it)',
  flip_outcome: 'it ends the other way round',
  move_setting: 'it happens somewhere else entirely',
  compress_time: 'months fold into a single moment',
}

export function distortionOffset(date: string): number {
  return fnv1a32(`dream:${date}`) % DREAM_DISTORTIONS.length
}

export function assignDistortions(date: string, count: number): DreamDistortion[] {
  const offset = distortionOffset(date)
  return Array.from({ length: count }, (_, i) => DREAM_DISTORTIONS[(offset + i) % DREAM_DISTORTIONS.length])
}

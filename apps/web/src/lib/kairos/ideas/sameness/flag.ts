import { mindSwitch } from '@/lib/kairos/level'
// Lane C anti-sameness flags (wave 3). All default off: unset → every idea
// prompt, context and job output stays byte-identical.

export type IdeaTriMode = 'off' | 'observe' | 'on'

export const SAMENESS_DISTANCE_DEFAULT = 0.15

function raw(name: string): string {
  return mindSwitch(name).trim().toLowerCase()
}

// KAIROS_IDEA_VS 0|1 — verbalized sampling, archetype lenses, keep-the-tail parse.
export function ideaVsEnabled(): boolean {
  const v = raw('KAIROS_IDEA_VS')
  return v === '1' || v === 'on'
}

// KAIROS_IDEA_RESAMPLE off|observe|1 — observe: measure batch sameness only; 1: one capped resample.
export function ideaResampleMode(): IdeaTriMode {
  const v = raw('KAIROS_IDEA_RESAMPLE')
  if (v === '1' || v === 'on') return 'on'
  if (v === 'observe') return 'observe'
  return 'off'
}

// KAIROS_IDEA_SAMENESS_DISTANCE — mean pairwise cosine distance below which a batch is too similar.
export function samenessDistance(): number {
  const v = raw('KAIROS_IDEA_SAMENESS_DISTANCE')
  const n = Number(v)
  return v !== '' && Number.isFinite(n) && n > 0 && n < 1 ? n : SAMENESS_DISTANCE_DEFAULT
}

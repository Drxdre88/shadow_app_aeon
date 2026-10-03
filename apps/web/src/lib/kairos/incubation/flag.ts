// Incubation shelf flag (wave 3 lane C). KAIROS_IDEA_SHELF off|observe|1:
// observe → the pulse records which near-miss it would offer, prompts and
// writes unchanged; 1 → offer and resurface. Default off. No effect unless
// daytime thinking and the today module are on (the pulse's own gates).

export type ShelfMode = 'off' | 'observe' | 'on'

export function ideaShelfMode(): ShelfMode {
  const v = (process.env.KAIROS_IDEA_SHELF ?? '').trim().toLowerCase()
  if (v === '1' || v === 'on') return 'on'
  if (v === 'observe') return 'observe'
  return 'off'
}

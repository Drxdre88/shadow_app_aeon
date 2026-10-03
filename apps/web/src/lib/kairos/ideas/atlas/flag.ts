// Lane A flags (wave 3), all off by default so every prompt and row stays
// byte-identical. KAIROS_IDEA_ATLAS: unset/'0'/'off' → off; 'observe' → tag
// candidates and fill empty cells only; '1'/'on' → targets + holder challenges.

export type IdeaAtlasMode = 'off' | 'observe' | 'on'

export function ideaAtlasMode(): IdeaAtlasMode {
  const raw = (process.env.KAIROS_IDEA_ATLAS ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

// KAIROS_IDEA_SWISS 0|1 — multi-round Swiss head-to-head judging.
export function ideaSwissEnabled(): boolean {
  const raw = (process.env.KAIROS_IDEA_SWISS ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'on'
}

export const SWISS_ROUNDS_DEFAULT = 5
export const SWISS_ROUNDS_MIN = 3
export const SWISS_ROUNDS_MAX = 6

// KAIROS_IDEA_SWISS_ROUNDS 3–6 (default 5).
export function ideaSwissRounds(): number {
  const raw = process.env.KAIROS_IDEA_SWISS_ROUNDS
  const n = raw === undefined || raw.trim() === '' ? NaN : Math.round(Number(raw))
  if (!Number.isFinite(n)) return SWISS_ROUNDS_DEFAULT
  return Math.min(SWISS_ROUNDS_MAX, Math.max(SWISS_ROUNDS_MIN, n))
}

// KAIROS_COLLISIONS: unset/'0' → off (nothing read, plan spec identical);
// 'observe' → pairs picked and stored in the job context only; '1'/'on' →
// pairs offered to the generator, blends gated, bridges written on accept.
export type CollisionMode = 'off' | 'observe' | 'on'

export function collisionMode(): CollisionMode {
  const raw = (process.env.KAIROS_COLLISIONS ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

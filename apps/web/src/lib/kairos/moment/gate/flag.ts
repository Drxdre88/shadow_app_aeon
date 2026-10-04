// Kairos gate flags (wave 4 lane A). All default off in code. Tri-state:
// unset/'0' → 'off'; 'observe' → decide + log only; '1'/'on' → live.

export type GateMode = 'off' | 'observe' | 'on'

function triState(name: string): GateMode {
  const raw = (process.env[name] ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

function minutes(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback
}

// KAIROS_GATE off|observe|1 — hold unprompted speaks until a natural break.
export const gateMode = (): GateMode => triState('KAIROS_GATE')

// KAIROS_GATE_RECEPTIVITY off|observe|1 — a cold London hour may extend a hold.
export const receptivityMode = (): GateMode => triState('KAIROS_GATE_RECEPTIVITY')

// A cold hour only holds when both the gate and receptivity are live.
export const coldHourHolds = (): boolean => gateMode() === 'on' && receptivityMode() === 'on'

export interface GateLimits {
  maxHoldMin: number
  quietMin: number
  chatQuietMin: number
  awayMin: number
}

export function gateLimits(): GateLimits {
  return {
    maxHoldMin: minutes('KAIROS_GATE_MAX_HOLD_MIN', 120, 15, 360),
    quietMin: minutes('KAIROS_GATE_QUIET_MIN', 10, 1, 240),
    chatQuietMin: minutes('KAIROS_GATE_CHAT_QUIET_MIN', 15, 1, 240),
    awayMin: minutes('KAIROS_GATE_AWAY_MIN', 180, 30, 1440),
  }
}

export function gateOperator(): string | null {
  return process.env.KAIROS_OPERATOR_USER_ID?.trim() || null
}

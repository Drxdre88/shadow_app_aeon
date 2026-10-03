// Model work bound per sweep INVOCATION (shared across users): at most
// `maxFallbacks` fallbacks, and none started after `budgetMs` of wall clock —
// the rest stay pending for the next hourly sweep. The route has 300s.
// Re-exported by queue.ts (its public home).
export const DEFAULT_SWEEP_MAX_FALLBACKS = 2
export const DEFAULT_SWEEP_BUDGET_MS = 200_000

export interface SweepBudget {
  // true → a fallback may start now (and is counted); false → defer it.
  tryStart(): boolean
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function createSweepBudget(opts: {
  maxFallbacks?: number
  budgetMs?: number
  clock?: () => number
} = {}): SweepBudget {
  const maxFallbacks = opts.maxFallbacks ?? envInt('KAIROS_SWEEP_MAX_FALLBACKS', DEFAULT_SWEEP_MAX_FALLBACKS)
  const budgetMs = opts.budgetMs ?? envInt('KAIROS_SWEEP_BUDGET_MS', DEFAULT_SWEEP_BUDGET_MS)
  const clock = opts.clock ?? Date.now
  const startedAt = clock()
  let started = 0
  return {
    tryStart() {
      if (started >= maxFallbacks || clock() - startedAt >= budgetMs) return false
      started++
      return true
    },
  }
}

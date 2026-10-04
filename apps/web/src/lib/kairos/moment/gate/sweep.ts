import { gateMode } from './flag'
import { foldReceptivity } from './fold'
import { releaseHeldSpeaks } from './release'

// Hourly thinking-sweep step (operator only, via the moment seam). Release
// always runs so a flag switched off flushes held rows; the fold runs only
// while the gate is observing or on. null = nothing happened → no sweep key.
// With the flag off a failed flush only logs, so the sweep JSON stays identical.
export async function runGateSweep(userId: string, now: Date): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = {}
  const live = gateMode() !== 'off'
  try {
    const release = await releaseHeldSpeaks(userId, now, 'tick')
    if (release) out.release = release
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (live) out.release = { error }
    else console.warn('[kairos:gate] held flush failed', error)
  }
  if (live) {
    try {
      const fold = await foldReceptivity(userId, now)
      if (fold) out.fold = fold
    } catch (err) {
      out.fold = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return Object.keys(out).length ? { gate: out } : null
}

import type { MomentLane } from '../types'
import { gateMode } from '../gate/flag'

// Lane A (Kairos gate): hold unprompted speaks to a natural break; learn a
// receptivity map. Flag first: KAIROS_GATE off → every hook returns before
// loading anything (sweep still flushes held rows so none is stranded).
export const gateLane: MomentLane = {
  async speakPolicy(ctx) {
    const mode = gateMode()
    if (mode === 'off') return null
    const { decideSpeakPolicy, isGateable } = await import('../gate/policy')
    if (!isGateable(ctx.input, ctx.gate)) return null
    return decideSpeakPolicy(ctx, mode)
  },

  async speakDelivered(event) {
    if (gateMode() === 'off') return
    const { isGateable } = await import('../gate/policy')
    if (!isGateable(event.input, true)) return
    const [{ mutateKairosGate }, { attachLogMemoryId }] = await Promise.all([
      import('@/lib/data/kairos-gate'),
      import('../gate/receptivity'),
    ])
    const at = event.now.toISOString()
    await mutateKairosGate(event.userId, (state) => ({ state: attachLogMemoryId(state, at, event.memoryId), result: null }))
  },

  async sweep(userId, now) {
    // Off: the flush still runs (never strand a held row) — unless no database
    // is configured, where nothing can be held and the data layer cannot load.
    if (gateMode() === 'off' && !process.env.DATABASE_URL) return null
    const { runGateSweep } = await import('../gate/sweep')
    return runGateSweep(userId, now)
  },
}

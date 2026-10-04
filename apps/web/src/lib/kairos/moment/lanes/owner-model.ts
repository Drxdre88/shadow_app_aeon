import { ownerModelMode } from '@/lib/kairos/owner-model/flag'
import type { MomentLane } from '../types'

// Lane B (traits vs states): owner model block, carrying card, corrections.
// Every hook is a no-op unless KAIROS_OWNER_MODEL=1 (observe only extracts and
// stores, via belief_extract). Owner-model modules load lazily: they reach
// lib/data. Readers are chat and the 06:00 message only.

const on = () => ownerModelMode() === 'on'

async function block(userId: string, now: Date): Promise<string> {
  const { loadOwnerModelBlock } = await import('@/lib/kairos/owner-model/block')
  return loadOwnerModelBlock(userId, { now })
}

export const ownerModelLane: MomentLane = {
  async chatContext(ctx) {
    if (!on()) return null
    const section = await block(ctx.userId, new Date())
    return section ? { section } : null
  },

  async daily(userId, now) {
    if (!on()) return null
    const section = await block(userId, now)
    return section ? { promptBlocks: [section] } : null
  },

  async sweep(userId, now) {
    if (!on()) return null
    const { runCarryingCardSweep } = await import('@/lib/kairos/owner-model/card-sweep')
    return runCarryingCardSweep(userId, now) as Promise<Record<string, unknown> | null>
  },

  async telegramText(ctx) {
    if (!on() || !/^\s*c\d/i.test(ctx.body)) return false
    const { routeOwnerModelCommands } = await import('@/lib/kairos/owner-model/telegram-commands')
    return routeOwnerModelCommands(ctx.userId, ctx.body, ctx.send, ctx.now, ctx.updateId)
  },

  async telegramCallback(ctx) {
    if (!on() || !ctx.data.startsWith('om1:')) return false
    const { handleOwnerCardCallback } = await import('@/lib/kairos/owner-model/callback')
    return handleOwnerCardCallback(ctx)
  },
}

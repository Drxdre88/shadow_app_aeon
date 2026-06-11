'use server'

import { requireAuth } from './helpers'
import { getLatestAether } from '@/lib/data/aether'
import type { AetherPayload } from '@/lib/kairos/aether-types'

// Aether — server action surface. Auth-guarded pass-through to the data layer.

export async function getAetherAction(): Promise<AetherPayload | null> {
  const userId = await requireAuth()
  return getLatestAether(userId)
}

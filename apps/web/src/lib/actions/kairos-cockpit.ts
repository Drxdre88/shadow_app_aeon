'use server'

import { requireVorath } from '@/lib/actions/helpers'
import { readMorningCockpit, type MorningCockpit } from '@/lib/data/morning-cockpit'

// The owner's morning cockpit for the web session; read-only, assembled on read.

export async function getOwnMorningCockpit(): Promise<MorningCockpit> {
  const userId = await requireVorath()
  return readMorningCockpit(userId)
}

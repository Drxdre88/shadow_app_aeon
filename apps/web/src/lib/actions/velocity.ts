'use server'

import { requireOwnership } from './helpers'
import {
  getVelocityStats as _getVelocityStats,
  type VelocityRange,
} from '@/lib/data/velocity'

export async function getVelocityStats(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getVelocityStats(projectId, range)
}

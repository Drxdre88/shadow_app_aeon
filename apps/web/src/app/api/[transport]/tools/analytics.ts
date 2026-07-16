import { z } from 'zod'
import { getVelocityStats } from '@/lib/data/velocity'
import { verifyProjectOwnership } from '@/lib/data/projects'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerAnalyticsTools: RegisterFn = (server) => {
  server.tool(
    'get_velocity_stats',
    'Get velocity analytics for a project: completion rate, cycle times, column dwell times, activity heatmap, priority breakdown',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      range: z.enum(['7d', '30d', '90d', 'all']).default('30d').describe('Time range for analysis'),
    },
    { title: 'Get Velocity Stats', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, range }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await getVelocityStats(projectId, range))
    }
  )
}

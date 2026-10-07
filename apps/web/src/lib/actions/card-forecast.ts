'use server'

import { requireMember } from './helpers'
import { readCardForecasts } from '@/lib/data/card-forecast'
import { getCardForecastSchema } from '@/lib/data/validators/card-forecast'

export async function getCardForecasts(projectId: string, taskId?: string) {
  const input = getCardForecastSchema.parse({ projectId, taskId })
  const userId = await requireMember(input.projectId)
  const view = await readCardForecasts(input.projectId, userId, { taskId: input.taskId })
  if (!view) throw new Error('Project not found or unauthorized')
  return view
}

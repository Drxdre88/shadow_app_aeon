'use server'

import { z } from 'zod'
import { requireOwnership } from './helpers'
import {
  findActivityEvents as _findActivityEvents,
  type ActivityEntityType,
} from '@/lib/data/activity'

const cursorSchema = z.string().datetime().optional()

export async function getActivityFeed(
  projectId: string,
  options?: {
    limit?: number
    cursor?: string
    entityType?: ActivityEntityType
    entityId?: string
  }
) {
  await requireOwnership(projectId)

  const cursorResult = cursorSchema.safeParse(options?.cursor)
  if (!cursorResult.success) throw new Error('Invalid cursor')

  const validatedOptions = {
    ...options,
    cursor: cursorResult.data,
    limit: options?.limit !== undefined ? Math.min(options.limit, 200) : undefined,
  }

  return _findActivityEvents(projectId, validatedOptions)
}

import { db } from '@/lib/db'
import { activityEvents } from '@/lib/db/schema'
import { eq, desc, and, lt } from 'drizzle-orm'

export type ActivityEntityType = 'task' | 'column' | 'dependency' | 'label' | 'gantt_task' | 'canvas_node' | 'project'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'moved' | 'completed' | 'vaulted' | 'archived' | 'restored' | 'dependency_added' | 'dependency_removed' | 'label_added' | 'label_removed'

export async function emitActivity(
  projectId: string,
  entityType: ActivityEntityType,
  entityId: string,
  action: ActivityAction,
  entityName?: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(activityEvents).values({
    projectId,
    entityType,
    entityId,
    action,
    entityName: entityName ?? null,
    metadata: metadata ?? {},
  })
}

export async function findActivityEvents(
  projectId: string,
  options?: {
    limit?: number
    cursor?: string
    entityType?: ActivityEntityType
    entityId?: string
  }
) {
  const limit = options?.limit ?? 50
  const conditions = [eq(activityEvents.projectId, projectId)]

  if (options?.cursor) {
    conditions.push(lt(activityEvents.createdAt, new Date(options.cursor)))
  }
  if (options?.entityType) {
    conditions.push(eq(activityEvents.entityType, options.entityType))
  }
  if (options?.entityId) {
    conditions.push(eq(activityEvents.entityId, options.entityId))
  }

  return db
    .select()
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit)
}

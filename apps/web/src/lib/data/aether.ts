import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'
import type { AetherPayload } from '../../lib/kairos/aether-types'

// Aether — pure DB accessor. Returns the newest non-archived aether memory.

export async function getLatestAether(userId: string): Promise<AetherPayload | null> {
  const [row] = await db
    .select({ sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.type, 'aether'),
        isNull(memories.archivedAt),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(1)

  if (!row) return null

  const meta = row.sourceMetadata as Record<string, unknown>
  return (meta?.aether as AetherPayload) ?? null
}

import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import type { EngineMemory } from '@/lib/kairos/engine/types'
import { toEngineMemory } from './memory-engine'

// Small-set memory lookups for the immediate (post-reaction) rescore and the
// chat undo tool (docs/kairos/34 §6). Pure DB reads — the standing rules live
// in lib/kairos/engine; writes reuse memory-engine's updateStandings so the
// standing and its 'score' op share one transaction.

const MAX_IDS = 50

// The engine rows for a handful of ids (retired rows included — Standing
// zeroes them). Meta stream classes are never scored, same as the weigh step.
export async function loadEngineMemoriesByIds(userId: string, ids: readonly string[]): Promise<EngineMemory[]> {
  const unique = [...new Set(ids)].slice(0, MAX_IDS)
  if (unique.length === 0) return []
  const rows = await db
    .select({
      id: memories.id,
      userId: memories.userId,
      dominionId: memories.dominionId,
      type: memories.type,
      streamClass: memories.streamClass,
      source: memories.source,
      confidence: memories.confidence,
      standing: memories.standing,
      pinned: memories.pinned,
      createdAt: memories.createdAt,
      validAt: memories.validAt,
      updatedAt: memories.updatedAt,
      lastUsedAt: memories.lastUsedAt,
      useCount: memories.useCount,
      supersededAt: memories.supersededAt,
      invalidAt: memories.invalidAt,
      archivedAt: memories.archivedAt,
      sourceMetadata: memories.sourceMetadata,
      links: memories.links,
      tags: memories.tags,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      inArray(memories.id, unique),
      notInArray(memories.streamClass, [...META_STREAM_CLASSES]),
    ))
  return rows.map(toEngineMemory)
}

// Titles for memory ids, archived/superseded rows included (a decayed proposal
// is archived, and it is exactly what an operator may want to undo).
export async function loadMemoryTitles(userId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, string>()
  if (unique.length === 0) return out
  const rows = await db
    .select({ id: memories.id, title: memories.title })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique)))
  for (const r of rows) out.set(r.id, r.title)
  return out
}

import { after } from 'next/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { activeEmbeddingModel, embeddingsEnabled, embedOne } from '@/lib/kairos/embeddings'
import { autoFileText } from '@/lib/kairos/autofile'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'

// Embed on write (Wave 1 "one search"): a new or edited memory becomes
// vector-searchable right after its write instead of waiting for the 03:25Z
// backfill, which stays as the safety net. Never on the write's critical path
// and never able to fail it.

export interface EmbeddableRow {
  id: string
  title: string
  summary: string | null
  bodyMd: string
  streamClass: string
  archivedAt: Date | null
  embedding?: unknown
}

const META: ReadonlySet<string> = new Set(META_STREAM_CLASSES)

// Same eligibility as backfillEmbeddings: live, not a machine meta row, no vector yet.
export function needsEmbedding(row: EmbeddableRow): boolean {
  return row.embedding == null && row.archivedAt == null && !META.has(row.streamClass)
}

// Embeds the row's current content and stores it only if the row still holds
// that content without a vector — an edit that raced ahead (and nulled the
// vector for new text) is left for the next write or the backfill.
export async function embedMemoryNow(userId: string, row: EmbeddableRow): Promise<boolean> {
  const model = activeEmbeddingModel()
  if (!model) return false
  const vec = await embedOne(autoFileText(row.title, row.summary, row.bodyMd), 'document')
  if (!vec) return false
  const stored = await db
    .update(memories)
    .set({ embedding: vec, embeddingModel: model })
    .where(and(
      eq(memories.id, row.id),
      eq(memories.userId, userId),
      isNull(memories.embedding),
      eq(memories.title, row.title),
      eq(memories.bodyMd, row.bodyMd),
      sql`${memories.summary} IS NOT DISTINCT FROM ${row.summary}`,
    ))
    .returning({ id: memories.id })
  return stored.length > 0
}

// Schedules embedMemoryNow via after() so it outlives the response on Vercel.
// Outside a request scope (scripts, unit tests) after() throws and nothing is
// scheduled: the nightly backfill embeds the row instead. Returns whether a
// job was scheduled.
export function scheduleMemoryEmbed(userId: string, row: EmbeddableRow | null | undefined): boolean {
  if (!row || !embeddingsEnabled() || !needsEmbedding(row)) return false
  const run = async () => {
    try {
      await embedMemoryNow(userId, row)
    } catch (err) {
      console.warn('[memory-embed] embed on write failed; backfill will retry', {
        memoryId: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  try {
    after(run)
    return true
  } catch {
    return false
  }
}

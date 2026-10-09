import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { ARCHETYPE_CONFIRMED_KEY, ARCHETYPE_REVISED_KEY } from '@/lib/data/synthesis-change'
import type { MemoryOpInput } from './engine/types'
import type { ArchetypeOutput } from './archetypes-prompt'
import { planArchetypeEdits, type IncomingArchetype } from './archetype-match'

// Persists one Dominion's generated archetypes as in-place edits of the live
// set (see archetype-match.ts), atomically. Kept rows only gain a confirmedAt
// stamp (the "this run looked at it" marker); updated rows keep their id and
// log an 'archetype_update' memory_ops row whose before snapshot is the undo
// handle (revertMemoryOp restores it like a concept_update). Nothing returned
// → nothing archived, so a failed run never empties the Dominion.

export const ARCHETYPE_STEP = 'archetype'

export interface PersistArchetypesResult {
  inserted: number
  updated: number
  kept: number
  archivedPrior: number
  archetypeMemoryIds: string[]
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface RowSnapshot {
  title: string
  bodyMd: string
  summary: string | null
  confidence: number | null
  links: unknown
  tags: unknown
  sourceMetadata: unknown
}

function snapshot(row: RowSnapshot): Record<string, unknown> {
  return {
    title: row.title,
    bodyMd: row.bodyMd,
    summary: row.summary,
    confidence: row.confidence,
    links: row.links,
    tags: row.tags,
    sourceMetadata: row.sourceMetadata,
  }
}

function runMetadata(dominionId: string, runId: string, parsed: ArchetypeOutput, a: IncomingArchetype) {
  return {
    runId,
    runDate: runId.split(':').pop() ?? null,
    dominionId,
    citedMemoryIds: a.citedMemoryIds,
    themes: a.themes,
    shifts: parsed.shifts,
  }
}

function contentOf(a: IncomingArchetype) {
  return {
    title: a.title.slice(0, 255),
    bodyMd: a.body,
    summary: a.summary.slice(0, 1000),
    tags: a.themes.slice(0, 50),
  }
}

async function readLive(tx: Tx, userId: string, dominionId: string) {
  return tx
    .select()
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
    ))
    .for('update')
}

export async function persistArchetypes(
  userId: string,
  dominionId: string,
  parsed: ArchetypeOutput,
  runId: string,
  now: Date = new Date(),
): Promise<PersistArchetypesResult> {
  const stamp = now.toISOString()
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${`archetype:${dominionId}`}))`)
    const live = await readLive(tx, userId, dominionId)
    const byId = new Map(live.map((r) => [r.id, r]))
    const plan = planArchetypeEdits(live, parsed.archetypes)
    const result: PersistArchetypesResult = { inserted: 0, updated: 0, kept: 0, archivedPrior: 0, archetypeMemoryIds: [] }
    if (plan.edits.length === 0) return result

    const ids = new Map<number, string>()
    const keepIds: string[] = []
    const ops: MemoryOpInput[] = []
    const inserts: Array<{ index: number; incoming: IncomingArchetype }> = []

    for (const [index, edit] of plan.edits.entries()) {
      if (edit.kind === 'insert') {
        inserts.push({ index, incoming: edit.incoming })
        continue
      }
      ids.set(index, edit.existing.id)
      if (edit.kind === 'keep') {
        keepIds.push(edit.existing.id)
        continue
      }
      const current = byId.get(edit.existing.id)!
      const [updated] = await tx
        .update(memories)
        .set({
          ...contentOf(edit.incoming),
          sourceMetadata: {
            ...((current.sourceMetadata ?? {}) as Record<string, unknown>),
            ...runMetadata(dominionId, runId, parsed, edit.incoming),
            [ARCHETYPE_CONFIRMED_KEY]: stamp,
            [ARCHETYPE_REVISED_KEY]: stamp,
          },
          embedding: null,
          embeddingModel: null,
          updatedAt: now,
        })
        .where(and(eq(memories.id, current.id), eq(memories.userId, userId)))
        .returning()
      if (!updated) continue
      ops.push({
        memoryId: current.id,
        step: ARCHETYPE_STEP,
        op: 'archetype_update',
        before: snapshot(current),
        after: snapshot(updated),
        reason: `archetype revised in place (${runId})`,
      })
      result.updated++
    }

    if (keepIds.length > 0) {
      await tx
        .update(memories)
        .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${JSON.stringify({ [ARCHETYPE_CONFIRMED_KEY]: stamp })}::jsonb` })
        .where(and(eq(memories.userId, userId), inArray(memories.id, keepIds)))
      result.kept = keepIds.length
    }

    if (inserts.length > 0) {
      const rows = await tx
        .insert(memories)
        .values(inserts.map(({ incoming }) => ({
          userId,
          dominionId,
          ...contentOf(incoming),
          type: 'archetype' as const,
          streamClass: 'archetype' as const,
          source: 'cron' as const,
          sourceMetadata: runMetadata(dominionId, runId, parsed, incoming),
          pinned: false,
        })))
        .returning({ id: memories.id })
      rows.forEach((r, k) => ids.set(inserts[k].index, r.id))
      result.inserted = rows.length
    }

    if (plan.archiveIds.length > 0) {
      const archived = await tx
        .update(memories)
        .set({ archivedAt: now })
        .where(and(
          eq(memories.userId, userId),
          inArray(memories.id, plan.archiveIds),
          eq(memories.pinned, false),
          isNull(memories.archivedAt),
        ))
        .returning({ id: memories.id })
      result.archivedPrior = archived.length
    }

    if (ops.length > 0) await insertMemoryOps(userId, null, ops, tx)
    result.archetypeMemoryIds = plan.edits.map((_, i) => ids.get(i)).filter((id): id is string => Boolean(id))
    return result
  })
}

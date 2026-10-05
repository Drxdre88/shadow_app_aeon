import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { BELIEF_TYPE, readBelief, type BeliefV1, type LostSourceState } from '@/lib/kairos/beliefs/types'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'
import { BELIEF_CONFIDENCE_CAP, type OriginKind } from '@/lib/kairos/origin'
import { notHeldSensitiveRaw } from '@/lib/kairos/sensitive/held'
import { listMemoryOrigins, originKindSqlOf } from './belief-inputs'
import { beliefField, isBelief, liveHeld, lockHeldBelief, type LockedBelief } from './beliefs'

// Belief re-check cascade data access (P2.5, docs/kairos/32 step 'recheck').
// Pure DB: the RecheckStep + lib/kairos/beliefs/support own the policy and
// decide each mutation under the row lock; the op commits in the same tx.

export type ProvenanceState = LostSourceState | 'merged'

export interface ProvenanceProbe {
  id: string
  state: ProvenanceState
  // 'merged' only: the live Merge survivor the provenance id should point to.
  survivorId: string | null
}

export interface BeliefSupportCheck {
  beliefId: string
  sourceMetadata: Record<string, unknown>
  links: unknown
  invalidAt: Date | null
  probes: ProvenanceProbe[]
}

const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

// Held beliefs (both minds) with at least one provenance memory that is gone
// (hard-deleted, archived, invalidated, or superseded with no live survivor)
// or merged (superseded by Merge into a live survivor). Sources the belief
// already records as lost, or whose flag the operator reverted, are skipped,
// so a handled belief stops matching and the cap walks the backlog.
export async function findBeliefSupportLosses(userId: string, now: Date, limit: number): Promise<BeliefSupportCheck[]> {
  const res = await db.execute(sql`
    WITH held AS (
      SELECT b.id, b.source_metadata, b.links, b.invalid_at, b.updated_at
      FROM memories b
      WHERE b.user_id = ${userId}
        AND b.type = ${BELIEF_TYPE}
        AND b.source_metadata->'belief' IS NOT NULL
        AND b.superseded_at IS NULL
        AND b.archived_at IS NULL
        AND b.source_metadata->'belief'->>'status' = 'held'
        AND jsonb_typeof(b.source_metadata->'belief'->'provenance') = 'array'
    ),
    probe AS (
      SELECT h.id AS belief_id, p.pid,
        CASE
          WHEN m.id IS NULL THEN 'missing'
          WHEN m.archived_at IS NOT NULL THEN 'archived'
          WHEN m.invalid_at IS NOT NULL AND m.invalid_at <= ${now} THEN 'invalidated'
          WHEN m.superseded_at IS NOT NULL AND m.invalid_at IS NULL AND s.id IS NOT NULL THEN 'merged'
          WHEN m.superseded_at IS NOT NULL THEN 'superseded'
        END AS state,
        s.id AS survivor_id
      FROM held h
      CROSS JOIN LATERAL jsonb_array_elements_text(h.source_metadata->'belief'->'provenance') AS p(pid)
      LEFT JOIN memories m
        ON m.user_id = ${userId}
        AND m.id = (CASE WHEN p.pid ~ ${UUID_RE} THEN p.pid::uuid END)
      LEFT JOIN memories s
        ON s.user_id = ${userId}
        AND s.id = m.superseded_by_id
        AND s.archived_at IS NULL
        AND (s.invalid_at IS NULL OR s.invalid_at > ${now})
      WHERE NOT (COALESCE(h.source_metadata->'belief'->'recheck'->'lostSources', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', p.pid)))
        AND NOT (COALESCE(h.source_metadata->'engine'->'vetoes'->'recheck'->'lostSources', '[]'::jsonb) ? p.pid)
    ),
    hit AS (
      SELECT belief_id, jsonb_agg(jsonb_build_object('id', pid, 'state', state, 'survivorId', survivor_id)) AS probes
      FROM probe
      WHERE state IS NOT NULL
      GROUP BY belief_id
    )
    SELECT h.id AS belief_id, h.source_metadata, h.links, h.invalid_at, hit.probes
    FROM hit JOIN held h ON h.id = hit.belief_id
    ORDER BY h.updated_at ASC, h.id ASC
    LIMIT ${Math.min(Math.max(limit, 1), 1000)}
  `)
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    beliefId: String(r.belief_id),
    sourceMetadata: (r.source_metadata ?? {}) as Record<string, unknown>,
    links: r.links,
    invalidAt: r.invalid_at ? new Date(r.invalid_at as string) : null,
    probes: (Array.isArray(r.probes) ? r.probes : []) as ProvenanceProbe[],
  }))
}

export interface NormaliseCandidate {
  beliefId: string
  sourceMetadata: Record<string, unknown>
  links: unknown
  invalidAt: Date | null
}

// Held beliefs (both minds) whose stored sourceType differs from the one their
// live provenance origins give, or whose confidence exceeds that type's cap
// (legacy rows from before the server set them). Own-mind beliefs are
// Kairos's view whatever they cite: pinned to 'inference' and its cap, so only
// an own belief labelled otherwise or above that cap is selected. Computed in SQL so a belief
// already in line is never selected; one whose provenance (or a provenance
// origin) changes is selected again. A belief whose normalisation the
// operator reverted (engine.vetoes.normalise) is left alone. Sources still
// held for private-topic review are not live evidence.
export async function findBeliefsToNormalise(userId: string, now: Date, limit: number): Promise<NormaliseCandidate[]> {
  if (limit <= 0) return []
  const kind = originKindSqlOf(sql.raw('m.source'), sql.raw('m.source_metadata'))
  const res = await db.execute(sql`
    WITH held AS (
      SELECT b.id, b.source_metadata, b.links, b.invalid_at, b.updated_at
      FROM memories b
      WHERE b.user_id = ${userId}
        AND b.type = ${BELIEF_TYPE}
        AND b.source_metadata->'belief' IS NOT NULL
        AND b.superseded_at IS NULL
        AND b.archived_at IS NULL
        AND b.source_metadata->'belief'->>'status' = 'held'
        AND jsonb_typeof(b.source_metadata->'belief'->'provenance') = 'array'
        AND b.source_metadata->'engine'->'vetoes'->'normalise' IS NULL
        AND jsonb_typeof(b.source_metadata->'belief'->'confidence') = 'number'
    ),
    typed AS (
      SELECT h.id,
        CASE
          WHEN bool_or(o.k = 'operator') THEN 'operator'
          WHEN bool_or(o.k IN ('activity', 'agent')) THEN 'tool'
          ELSE 'inference'
        END AS computed
      FROM held h
      LEFT JOIN LATERAL (
        SELECT ${kind} AS k
        FROM jsonb_array_elements_text(h.source_metadata->'belief'->'provenance') AS p(pid)
        JOIN memories m
          ON m.user_id = ${userId}
          AND m.id = (CASE WHEN p.pid ~ ${UUID_RE} THEN p.pid::uuid END)
          AND m.archived_at IS NULL
          AND (m.invalid_at IS NULL OR m.invalid_at > ${now})
          AND ${sql.raw(notHeldSensitiveRaw('m'))}
      ) o ON true
      GROUP BY h.id
    )
    SELECT h.id AS belief_id, h.source_metadata, h.links, h.invalid_at
    FROM typed t JOIN held h ON h.id = t.id
    WHERE (
        h.source_metadata->'belief'->>'mind' = 'aligned'
        AND (
          t.computed IS DISTINCT FROM h.source_metadata->'belief'->>'sourceType'
          OR (h.source_metadata->'belief'->>'confidence')::float8 > (CASE t.computed
            WHEN 'operator' THEN ${BELIEF_CONFIDENCE_CAP.operator}::float8
            WHEN 'tool' THEN ${BELIEF_CONFIDENCE_CAP.tool}::float8
            ELSE ${BELIEF_CONFIDENCE_CAP.inference}::float8 END) + 1e-9
        )
      ) OR (
        h.source_metadata->'belief'->>'mind' = 'own'
        AND (
          h.source_metadata->'belief'->>'sourceType' IS DISTINCT FROM 'inference'
          OR (h.source_metadata->'belief'->>'confidence')::float8 > ${BELIEF_CONFIDENCE_CAP.inference}::float8 + 1e-9
        )
      )
    ORDER BY h.updated_at ASC, h.id ASC
    LIMIT ${Math.min(Math.max(limit, 1), 1000)}
  `)
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    beliefId: String(r.belief_id),
    sourceMetadata: (r.source_metadata ?? {}) as Record<string, unknown>,
    links: r.links,
    invalidAt: r.invalid_at ? new Date(r.invalid_at as string) : null,
  }))
}

export interface BeliefMutation {
  sourceMetadata: Record<string, unknown>
  links?: unknown[]
  invalidAt?: Date | null
  supersededAt?: null
  ops: Array<Omit<MemoryOpInput, 'memoryId'>>
}

// Lock a held belief (either mind), let `decide` plan the change from the
// locked row (null = nothing to do), then write the row and its ops in ONE
// transaction. Returns the ops written. `withOrigins` also reads the origins
// of the belief's provenance inside the same transaction for `decide`.
export async function mutateHeldBelief(
  userId: string,
  beliefId: string,
  decide: (row: LockedBelief, origins: ReadonlyMap<string, OriginKind>) => BeliefMutation | null,
  runId: string | null,
  now: Date,
  opts: { withOrigins?: boolean } = {},
): Promise<MemoryOpInput[]> {
  return db.transaction(async (tx) => {
    const row = await lockHeldBelief(tx, userId, beliefId, null)
    if (!row) return []
    const provenance = opts.withOrigins ? readBelief(row.sourceMetadata)?.provenance ?? [] : []
    const origins = provenance.length ? await listMemoryOrigins(userId, provenance, tx) : new Map<string, OriginKind>()
    const m = decide(row, origins)
    if (!m || m.ops.length === 0) return []
    const set: Record<string, unknown> = { sourceMetadata: m.sourceMetadata, updatedAt: now }
    if (m.links) set.links = m.links
    if (m.invalidAt !== undefined) set.invalidAt = m.invalidAt
    if (m.supersededAt !== undefined) set.supersededAt = m.supersededAt
    await tx
      .update(memories)
      .set(set)
      .where(and(eq(memories.id, beliefId), eq(memories.userId, userId)))
    const ops = m.ops.map((o) => ({ ...o, memoryId: beliefId }))
    await insertMemoryOps(userId, runId, ops, tx)
    return ops
  })
}

export const RECHECK_IN_PROMPT_CAP = 20

export interface FlaggedBelief {
  id: string
  belief: BeliefV1 & { recheck: NonNullable<BeliefV1['recheck']> }
}

// Held ALIGNED beliefs carrying a re-check flag. The window rotates: flags
// never put to the model come first (oldest flag first), then those in
// `presentedOrder` (least recently presented first), so every flag is shown
// eventually however many stay unresolved. A belief whose model retire the
// operator reverted (engine.vetoes.retire) is not put to the model again.
export async function listFlaggedAlignedBeliefs(
  userId: string,
  limit = RECHECK_IN_PROMPT_CAP,
  presentedOrder: readonly string[] = [],
): Promise<FlaggedBelief[]> {
  const presented = sql`ARRAY[${sql.join(presentedOrder.map((id) => sql`${id}`), sql`, `)}]::text[]`
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isBelief,
      liveHeld,
      sql`${beliefField('mind')} = 'aligned'`,
      sql`(${memories.sourceMetadata}->'belief'->'recheck') IS NOT NULL`,
      sql`(${memories.sourceMetadata}->'engine'->'vetoes'->'retire') IS NULL`,
    ))
    .orderBy(
      sql`COALESCE(array_position(${presented}, ${memories.id}::text), 0) ASC`,
      sql`${memories.sourceMetadata}->'belief'->'recheck'->>'since' ASC`,
      asc(memories.id),
    )
    .limit(Math.min(Math.max(limit, 1), RECHECK_IN_PROMPT_CAP))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    return b?.recheck ? [{ id: r.id, belief: { ...b, recheck: b.recheck } }] : []
  })
}

export interface OpenBelief {
  id: string
  belief: BeliefV1
  // The row's whole sourceMetadata (the surprise mark lives under engine.*).
  sourceMetadata: Record<string, unknown>
}

// Held ALIGNED beliefs open for update at `now` (surprise mark, spec_surprise)
// and NOT carrying a re-check flag (those come through
// listFlaggedAlignedBeliefs; both share RECHECK_IN_PROMPT_CAP). Closing
// soonest first. A belief whose model retire the operator reverted is skipped.
export async function listOpenAlignedBeliefs(userId: string, now: Date, limit = RECHECK_IN_PROMPT_CAP): Promise<OpenBelief[]> {
  if (limit <= 0) return []
  const openUntil = sql`(${memories.sourceMetadata} #>> '{engine,surprise,openUntil}')`
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isBelief,
      liveHeld,
      sql`${beliefField('mind')} = 'aligned'`,
      sql`${openUntil} COLLATE "C" > ${now.toISOString()}`,
      sql`(${memories.sourceMetadata}->'belief'->'recheck') IS NULL`,
      sql`(${memories.sourceMetadata}->'engine'->'vetoes'->'retire') IS NULL`,
    ))
    .orderBy(sql`${openUntil} COLLATE "C" ASC`, asc(memories.id))
    .limit(Math.min(limit, RECHECK_IN_PROMPT_CAP))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    return b ? [{ id: r.id, belief: b, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }] : []
  })
}

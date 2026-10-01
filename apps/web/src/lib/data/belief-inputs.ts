import { and, asc, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { validAsOfNow } from '@/lib/data/memories'
import type { SignalInputRow } from '@/lib/kairos/beliefs/extract-prompt'
import { mayShapeBeliefs, originKindOf, type OriginKind } from '@/lib/kairos/origin'

// Belief-extraction inputs (docs/kairos/34 §1): the signals a belief may rest
// on, labelled by origin (lib/kairos/origin.ts), and the origins of a belief's
// provenance. Pure DB. Re-exported by ./beliefs.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Handle = Tx | typeof db

// SQL twin of originKindOf (lib/kairos/origin.ts), over any source /
// source_metadata expressions (a column or a raw alias). Used to pre-select
// rows (external signals, beliefs needing normalisation); the JS check stays
// the truth.
export function originKindSqlOf(source: SQL, meta: SQL): SQL {
  return sql`COALESCE(
  CASE WHEN ${meta}->'origin'->>'kind' IN ('operator','activity','agent','kairos','external')
    THEN ${meta}->'origin'->>'kind' END,
  CASE
    WHEN ${meta}->>'kind' IN ('board_day','board_week','hangar_mission') THEN 'activity'
    WHEN ${source} IN ('manual','voice') THEN 'operator'
    WHEN ${source} IN ('cron','system') THEN 'kairos'
    WHEN ${source} IN ('claude','codex','copilot','hook') THEN 'agent'
    ELSE 'external'
  END)`
}

const originKindSql = originKindSqlOf(sql`${memories.source}`, sql`${memories.sourceMetadata}`)
export const mayShapeBeliefsSql = sql`${originKindSql} <> 'external'`

export const SIGNAL_INPUT_CAP = 60

const signalColumns = {
  id: memories.id,
  title: memories.title,
  aiTitle: memories.aiTitle,
  summary: memories.summary,
  bodyMd: memories.bodyMd,
  type: memories.type,
  kind: sql<string | null>`${memories.sourceMetadata}->>'kind'`,
  createdAt: memories.createdAt,
  source: memories.source,
  sourceMetadata: memories.sourceMetadata,
}

type SignalSelectRow = Omit<SignalInputRow, 'origin'> & { source: string | null; sourceMetadata: unknown }

// Rows labelled by origin; external content never shapes a belief.
function toSignalInputs(rows: readonly SignalSelectRow[]): SignalInputRow[] {
  return rows.flatMap(({ source, sourceMetadata, ...row }) => {
    const origin = originKindOf({ source, sourceMetadata })
    return mayShapeBeliefs(origin) ? [{ ...row, origin }] : []
  })
}

// Signals since `since` (exclusive), OLDEST first, so a backlog larger than
// one batch drains over successive nights: the planner's watermark is the
// newest row it actually consumed. Reflections (incl. dialogue reflections,
// answered asks and chat distills) + board-day pages, each labelled by origin;
// external-origin rows are excluded.
export async function listOperatorSignals(userId: string, since: Date | null, limit = SIGNAL_INPUT_CAP): Promise<SignalInputRow[]> {
  const conds: SQL[] = [
    eq(memories.userId, userId),
    isNull(memories.archivedAt),
    isNull(memories.supersededAt),
    validAsOfNow,
    sql`(${memories.streamClass} = 'reflection' OR ${memories.type} = 'reflection' OR ${memories.sourceMetadata}->>'kind' = 'board_day')`,
    mayShapeBeliefsSql,
  ]
  if (since) conds.push(gt(memories.createdAt, since))
  const rows = await db
    .select(signalColumns)
    .from(memories)
    .where(and(...conds))
    .orderBy(asc(memories.createdAt), asc(memories.id))
    .limit(Math.min(Math.max(limit, 1), SIGNAL_INPUT_CAP))
  return toSignalInputs(rows)
}

// Live (not archived, still valid) memories by id, as labelled prompt rows:
// a flagged belief's remaining evidence. External rows are left out.
export async function listBeliefEvidence(userId: string, ids: readonly string[]): Promise<SignalInputRow[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(signalColumns)
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, [...ids]), isNull(memories.archivedAt), validAsOfNow))
    .orderBy(desc(memories.createdAt))
  return toSignalInputs(rows)
}

// Origin of each live provenance memory (missing / archived / invalidated rows
// are absent: they no longer support anything). A merged row keeps its origin.
export async function listMemoryOrigins(userId: string, ids: readonly string[], h: Handle = db): Promise<Map<string, OriginKind>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await h
    .select({ id: memories.id, source: memories.source, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique), isNull(memories.archivedAt), validAsOfNow))
  return new Map(rows.map((r) => [r.id, originKindOf(r)]))
}


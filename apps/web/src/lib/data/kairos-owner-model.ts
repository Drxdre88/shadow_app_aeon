import { db } from '@/lib/db'
import { memories, userPreferences } from '@/lib/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { validAsOfNow } from '@/lib/data/memories'
import { KAIROS_OWNER_MODEL_PREF_KEY } from '@/lib/kairos/moment/pref-keys'
import { originKindOf, type OriginKind } from '@/lib/kairos/origin'
import { pruneOwnerModel } from '@/lib/kairos/owner-model/rules'
import { effectiveStatus, emptyOwnerModel, isLongRunning, isoMs } from '@/lib/kairos/owner-model/status'
import {
  kairosOwnerModelSchema,
  type KairosOwnerModel,
  type KairosOwnerModelView,
  type OwnerItem,
  type OwnerItemView,
} from './validators/kairos-owner-model'

// The Kairos owner model (wave 4 lane B) lives as the server-owned
// `kairosOwnerModel` key inside user_preferences.preferences (no schema
// change). This module is the ONLY writer: every write runs
// mutateKairosOwnerModel — SELECT … FOR UPDATE inside db.transaction, a pure
// mutation, pruning + caps, then a jsonb merge of just this key.
export { KAIROS_OWNER_MODEL_PREF_KEY }

export class KairosOwnerModelCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosOwnerModel preference is malformed: ${detail}`)
    this.name = 'KairosOwnerModelCorruptError'
  }
}

// Missing key = an empty model; a present but malformed blob throws so no
// write path can silently clobber it.
export function parseOwnerModel(raw: unknown): KairosOwnerModel {
  if (raw === undefined || raw === null) return emptyOwnerModel()
  const parsed = kairosOwnerModelSchema.safeParse(raw)
  if (!parsed.success) throw new KairosOwnerModelCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const ownerModelValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_OWNER_MODEL_PREF_KEY}::text`

export async function readKairosOwnerModel(userId: string): Promise<KairosOwnerModel> {
  const row = await db
    .select({ value: ownerModelValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseOwnerModel(row?.value)
}

// `state: null` = nothing to write. Pure: it can run twice if a concurrent
// first insert of the preferences row wins.
export type OwnerModelMutation<R> = (model: KairosOwnerModel) => { state: KairosOwnerModel | null; result: R }

export async function mutateKairosOwnerModel<R>(userId: string, mutate: OwnerModelMutation<R>, now: Date = new Date()): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: ownerModelValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseOwnerModel(rows[0]?.value))
      if (!state) return result
      const next = kairosOwnerModelSchema.parse(pruneOwnerModel(state, now))
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_OWNER_MODEL_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_OWNER_MODEL_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-owner-model: could not lock the preferences row')
  })
}

// Origin + createdAt of each live provenance memory (missing / archived /
// invalidated rows are absent). createdAt drives the state clock.
export async function listOwnerProvenance(
  userId: string,
  ids: readonly string[],
): Promise<Map<string, { origin: OriginKind; createdAt: Date }>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({ id: memories.id, source: memories.source, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique), isNull(memories.archivedAt), validAsOfNow))
  return new Map(rows.map((r) => [r.id, { origin: originKindOf(r), createdAt: r.createdAt }]))
}

// ── Read view (MCP get_kairos_owner_model ≡ GET /api/v1/kairos/owner-model) ──

const CORRECTION_WINDOW_MS = 30 * 86_400_000

function itemView(item: OwnerItem, now: Date): OwnerItemView {
  return {
    seq: item.seq,
    kind: item.kind,
    text: item.text,
    domain: item.domain,
    status: effectiveStatus(item, now),
    firstSeenAt: item.firstSeenAt,
    lastConfirmedAt: item.lastConfirmedAt,
    expiresAt: item.expiresAt ?? null,
    confirmations: item.confirmations.length,
    ownerWorded: item.ownerText !== undefined,
    longRunning: isLongRunning(item, now),
  }
}

// Live, candidate, expired and closed items with dates, the last card and a
// 30-day correction tally (no memory ids, no veto texts).
export function toKairosOwnerModelView(model: KairosOwnerModel, opts: { now?: Date } = {}): KairosOwnerModelView {
  const now = opts.now ?? new Date()
  const views = model.items.map((i) => itemView(i, now))
  const recent = model.corrections.filter((c) => now.getTime() - isoMs(c.at) <= CORRECTION_WINDOW_MS)
  const byAction: Record<string, number> = {}
  for (const c of recent) byAction[c.action] = (byAction[c.action] ?? 0) + 1
  const last = model.cards[model.cards.length - 1]
  return {
    live: views.filter((v) => v.status === 'held'),
    candidates: views.filter((v) => v.status === 'candidate'),
    expired: views.filter((v) => v.status === 'expired'),
    closed: views.filter((v) => v.status === 'ended' || v.status === 'retired'),
    lastCard: last ? { isoWeek: last.isoWeek, at: last.at, status: last.status, items: last.seqs.length } : null,
    corrections: { last30d: recent.length, byAction },
    vetoes: model.vetoes.filter((v) => isoMs(v.until) > now.getTime()).length,
  }
}

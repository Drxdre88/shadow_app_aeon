import { db } from '@/lib/db'
import { activityEvents, memories, userPreferences } from '@/lib/db/schema'
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { KAIROS_GATE_PREF_KEY } from '@/lib/kairos/moment/pref-keys'
import { gateLimits, gateMode, receptivityMode } from '@/lib/kairos/moment/gate/flag'
import { appendGateLog, cellView, emptyGateState, isColdHour } from '@/lib/kairos/moment/gate/receptivity'
import {
  GATE_LOG_MAX,
  kairosGateStateSchema,
  type GateCell,
  type GateCellView,
  type GateHeldView,
  type GateLogEntry,
  type KairosGateState,
  type KairosGateView,
} from './validators/kairos-gate'

// Kairos gate (wave 4 lane A): the `kairosGate` preference key (receptivity
// map + decision log) and the held-speak rows. Every preference write runs
// mutateKairosGate — SELECT … FOR UPDATE on the preferences row inside
// db.transaction, a pure mutation, then a jsonb merge of just this key.
// Held rows are kairosSpeak memories with status 'held'; claimHeldSpeak flips
// one to 'pending' atomically so a release is single-flight.

export class KairosGateCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosGate preference is malformed: ${detail}`)
    this.name = 'KairosGateCorruptError'
  }
}

export function parseKairosGate(raw: unknown): KairosGateState {
  if (raw === undefined || raw === null) return emptyGateState()
  const parsed = kairosGateStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosGateCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const gateValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_GATE_PREF_KEY}::text`

export async function readKairosGate(userId: string): Promise<KairosGateState> {
  const row = await db
    .select({ value: gateValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseKairosGate(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type GateMutation<R> = (state: KairosGateState) => { state: KairosGateState | null; result: R }

export async function mutateKairosGate<R>(userId: string, mutate: GateMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: gateValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseKairosGate(rows[0]?.value))
      if (!state) return result
      const next = kairosGateStateSchema.parse({ ...state, log: state.log.slice(-GATE_LOG_MAX) })
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_GATE_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_GATE_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-gate: could not lock the preferences row')
  })
}

export async function appendKairosGateLog(userId: string, entries: readonly GateLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  await mutateKairosGate(userId, (state) => ({ state: appendGateLog(state, entries), result: null }))
}

// ── Held speaks ──────────────────────────────────────────────────────────

const speakScope = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'inbound'),
  eq(memories.source, 'system'),
  sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
)

export interface HeldSpeakRow {
  id: string
  title: string
  bodyMd: string
  createdAt: Date
  sourceMetadata: unknown
}

// Oldest first.
export async function listHeldSpeaks(userId: string, limit = 20): Promise<HeldSpeakRow[]> {
  return db
    .select({ id: memories.id, title: memories.title, bodyMd: memories.bodyMd, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(speakScope(userId), sql`${memories.sourceMetadata}->>'status' = 'held'`))
    .orderBy(asc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
}

// Single-flight: only the caller whose UPDATE still sees status 'held' gets the row.
export async function claimHeldSpeak(userId: string, memoryId: string, releasedAt: Date, releaseReason: string): Promise<HeldSpeakRow | null> {
  const stamp = JSON.stringify({ releasedAt: releasedAt.toISOString(), releaseReason })
  const [row] = await db
    .update(memories)
    .set({
      sourceMetadata: sql`${memories.sourceMetadata} || jsonb_build_object(
        'status', 'pending',
        'gate', coalesce(${memories.sourceMetadata}->'gate', '{}'::jsonb) || ${stamp}::jsonb
      )`,
      updatedAt: releasedAt,
    })
    .where(and(speakScope(userId), eq(memories.id, memoryId), sql`${memories.sourceMetadata}->>'status' = 'held'`))
    .returning({ id: memories.id, title: memories.title, bodyMd: memories.bodyMd, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
  return row ?? null
}

export interface FoldSpeakRow {
  id: string
  createdAt: Date
  sourceMetadata: unknown
}

// Conversational speaks created in (from − slack, to]; the caller derives the
// send instant (release time for held rows) and filters precisely.
export async function listSpeaksForFold(userId: string, from: Date, to: Date, slackMs: number): Promise<FoldSpeakRow[]> {
  return db
    .select({ id: memories.id, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      speakScope(userId),
      sql`(${memories.sourceMetadata}->>'opsAlert') IS DISTINCT FROM 'true'`,
      sql`(${memories.sourceMetadata}->>'status') IS DISTINCT FROM 'held'`,
      gte(memories.createdAt, new Date(from.getTime() - slackMs)),
      lte(memories.createdAt, to),
    ))
    .orderBy(asc(memories.createdAt))
    .limit(200)
}

// Newest card the owner closed by hand (web), since `since`. MCP closes are agents.
export async function findLatestOwnerCardClose(userId: string, since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.actorId, userId),
      eq(activityEvents.actorType, 'user'),
      inArray(activityEvents.action, ['completed', 'vaulted']),
      gte(activityEvents.createdAt, since),
    ))
    .orderBy(desc(activityEvents.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

// ── Read view (MCP get_kairos_gate ≡ GET /api/v1/kairos/gate) ─────────────

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function heldView(row: HeldSpeakRow): GateHeldView {
  const meta = row.sourceMetadata && typeof row.sourceMetadata === 'object' ? (row.sourceMetadata as Record<string, unknown>) : {}
  const gate = meta.gate && typeof meta.gate === 'object' ? (meta.gate as Record<string, unknown>) : {}
  return { id: row.id, title: row.title, heldAt: str(gate.heldAt), until: str(gate.until), reason: str(gate.reason) }
}

const viewRecord = (r: Record<string, GateCell>): Record<string, GateCellView> =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([k, c]) => [k, cellView(c)]))

export function toKairosGateView(state: KairosGateState, held: readonly HeldSpeakRow[], opts: { logLimit?: number } = {}): KairosGateView {
  const rec = state.receptivity
  return {
    mode: gateMode(),
    receptivityMode: receptivityMode(),
    limits: gateLimits(),
    held: held.map(heldView),
    receptivity: {
      foldedThrough: rec.foldedThrough,
      updatedAt: rec.updatedAt,
      global: cellView(rec.global),
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, ...cellView(rec.hour[String(hour)]), cold: isColdHour(rec, hour) }))
        .filter((h) => h.n > 0),
      dow: viewRecord(rec.dow),
      kind: viewRecord(rec.kind),
      source: viewRecord(rec.source),
      breakType: viewRecord(rec.breakType),
      replyChannel: Object.fromEntries(Object.entries(rec.replyChannel).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    },
    log: [...state.log].reverse().slice(0, opts.logLimit ?? 20),
  }
}

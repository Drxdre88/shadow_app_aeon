import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, sessionEvents } from '@/lib/db/schema'
import type { Origin } from '@/lib/kairos/origin'
import {
  TODAY_CHANNELS,
  TODAY_MAX_ENTRIES,
  TODAY_RETENTION_HOURS,
  TODAY_SAMPLES_MAX,
  TODAY_TYPES,
  type TodayChannel,
  type TodayClientKind,
  type TodayCovered,
  type TodaySpeaker,
  type TodayType,
} from './validators/kairos-today'

// ─────────────────────────────────────────────────────────────────────────
// Kairos "today" — data layer (spec_one_mind, Kairos 0.21).
//
// One internal agent_sessions row per user (engine='kairos-today') holds the
// rolling cross-channel log; each entry is a session_events row with
// kind='kairos_today' and toolName=<channel>. No schema change. Today is a
// CACHE that indexes canonical records — never a source of memories.
//
// Every write is ONE short transaction under a per-user advisory lock:
// find-or-create the parent → dedupe on payload.key → update (upsert /
// coalesce) or insert at MAX(seq)+1 → purge past the 500-entry cap. Nothing
// else runs inside it (Neon pool acquire times out at 8s).
// ─────────────────────────────────────────────────────────────────────────

export const TODAY_ENGINE = 'kairos-today' as const
export const TODAY_EVENT_KIND = 'kairos_today' as const
export const TODAY_HARD_STOP_HOURS = 72
const TODAY_LOCK_NS = 'kairos-today'
const HOUR_MS = 3_600_000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface TodayRef {
  threadId?: string
  seq?: number
  memoryId?: string
  askId?: string
  dialogueId?: string
  jobId?: string
}

export interface TodayClient {
  kind: TodayClientKind
  fp: string
  label?: string
}

export interface TodayEntryPayload {
  v: 1
  key: string
  channel: TodayChannel
  type: TodayType
  origin: Origin
  speaker: TodaySpeaker
  relayedRole?: 'operator'
  text: string
  ref?: TodayRef
  covered: TodayCovered | null
  client?: TodayClient
  tool?: string
  count?: number
  lastAt?: string
  samples?: string[]
}

export interface TodayEntryView {
  at: string
  channel: TodayChannel
  type: TodayType
  speaker: TodaySpeaker
  relayed: boolean
  text: string
  tool?: string
  count?: number
  lastAt?: string
  samples?: string[]
  ref?: TodayRef
}

export interface TodayDigest {
  entries: TodayEntryView[]
  from: string
  to: string
}

export interface TodayRow {
  createdAt: Date
  toolName: string | null
  payload: unknown
}

export interface ListTodayEntriesInput {
  hours: number
  limit: number
  channel?: TodayChannel
  channels?: TodayChannel[]
  excludeTypes?: TodayType[]
  excludeThreadId?: string
  now?: Date
}

export type TodayWriteMode = 'upsert' | 'coalesce'

export function todayWindow(hours: number, now: Date = new Date()): { from: Date; to: Date } {
  const h = Math.min(Math.max(hours, 1), TODAY_RETENTION_HOURS)
  return { from: new Date(now.getTime() - h * HOUR_MS), to: now }
}

const keyMatches = (key: string) => sql`${sessionEvents.payload}->>'key' = ${key}`

async function findOrCreateParent(tx: Tx, userId: string): Promise<string> {
  const [found] = await tx
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(and(eq(agentSessions.userId, userId), eq(agentSessions.engine, TODAY_ENGINE)))
    .orderBy(agentSessions.spawnedAt)
    .limit(1)
  if (found) return found.id
  const [created] = await tx
    .insert(agentSessions)
    .values({
      userId,
      engine: TODAY_ENGINE,
      goal: 'Kairos · today',
      prompt: '',
      status: 'running',
      metadata: { kind: TODAY_ENGINE, v: 1 },
    })
    .returning({ id: agentSessions.id })
  return created.id
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function coalesceTodayPayload(existing: unknown, incoming: TodayEntryPayload): TodayEntryPayload {
  const prev = asRecord(existing)
  const prevCount = typeof prev.count === 'number' && prev.count > 0 ? prev.count : 1
  const prevSamples = Array.isArray(prev.samples) ? prev.samples.filter((s): s is string => typeof s === 'string') : []
  const samples = [...new Set([...prevSamples, ...(incoming.samples ?? [])])].slice(0, TODAY_SAMPLES_MAX)
  return {
    ...incoming,
    count: prevCount + (incoming.count ?? 1),
    ...(samples.length ? { samples } : {}),
  }
}

export async function writeTodayEntry(
  userId: string,
  payload: TodayEntryPayload,
  mode: TodayWriteMode = 'upsert',
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${TODAY_LOCK_NS}), hashtext(${userId}))`)
    const parentId = await findOrCreateParent(tx, userId)

    const [existing] = await tx
      .select({ id: sessionEvents.id, payload: sessionEvents.payload })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, parentId), eq(sessionEvents.kind, TODAY_EVENT_KIND), keyMatches(payload.key)))
      .limit(1)

    if (existing) {
      const next = mode === 'coalesce' ? coalesceTodayPayload(existing.payload, payload) : payload
      await tx.update(sessionEvents).set({ payload: next, toolName: payload.channel }).where(eq(sessionEvents.id, existing.id))
      return
    }

    const [last] = await tx
      .select({ seq: sessionEvents.seq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, parentId))
      .orderBy(desc(sessionEvents.seq))
      .limit(1)
    const seq = (last?.seq ?? 0) + 1

    await tx.insert(sessionEvents).values({
      sessionId: parentId,
      seq,
      kind: TODAY_EVENT_KIND,
      toolName: payload.channel,
      payload: mode === 'coalesce' ? { ...payload, count: payload.count ?? 1 } : payload,
    })

    if (seq > TODAY_MAX_ENTRIES) {
      await tx.execute(sql`
        delete from ${sessionEvents}
        where ${sessionEvents.id} in (
          select ${sessionEvents.id} from ${sessionEvents}
          where ${sessionEvents.sessionId} = ${parentId}
          order by ${sessionEvents.seq} desc
          offset ${TODAY_MAX_ENTRIES}
        )`)
    }
  })
}

function todayScope(userId: string) {
  return and(
    eq(agentSessions.userId, userId),
    eq(agentSessions.engine, TODAY_ENGINE),
    eq(sessionEvents.kind, TODAY_EVENT_KIND),
  )
}

export async function listTodayEntries(userId: string, input: ListTodayEntriesInput): Promise<TodayRow[]> {
  const { from } = todayWindow(input.hours, input.now)
  const where = [todayScope(userId), gte(sessionEvents.createdAt, from)]
  const channels = input.channel ? [input.channel] : input.channels
  if (channels?.length) where.push(inArray(sessionEvents.toolName, channels))
  if (input.excludeTypes?.length) {
    where.push(sql`coalesce(${sessionEvents.payload}->>'type', '') not in (${sql.join(input.excludeTypes.map((t) => sql`${t}`), sql`, `)})`)
  }
  if (input.excludeThreadId) {
    where.push(sql`coalesce(${sessionEvents.payload}->'ref'->>'threadId', '') <> ${input.excludeThreadId}`)
    where.push(sql`coalesce(${sessionEvents.payload}->'ref'->>'dialogueId', '') <> ${input.excludeThreadId}`)
  }

  const rows = await db
    .select({ createdAt: sessionEvents.createdAt, toolName: sessionEvents.toolName, payload: sessionEvents.payload })
    .from(sessionEvents)
    .innerJoin(agentSessions, eq(agentSessions.id, sessionEvents.sessionId))
    .where(and(...where))
    .orderBy(desc(sessionEvents.createdAt), desc(sessionEvents.seq))
    .limit(Math.max(1, input.limit))
  return rows.reverse()
}

export async function countTodayEntries(
  userId: string,
  since: Date,
  speakers?: TodaySpeaker[],
): Promise<number> {
  const where = [todayScope(userId), gte(sessionEvents.createdAt, since)]
  if (speakers?.length) {
    where.push(sql`${sessionEvents.payload}->>'speaker' in (${sql.join(speakers.map((s) => sql`${s}`), sql`, `)})`)
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionEvents)
    .innerJoin(agentSessions, eq(agentSessions.id, sessionEvents.sessionId))
    .where(and(...where))
  return Number(row?.n ?? 0)
}

const isChannel = (v: unknown): v is TodayChannel => typeof v === 'string' && (TODAY_CHANNELS as readonly string[]).includes(v)
const isType = (v: unknown): v is TodayType => typeof v === 'string' && (TODAY_TYPES as readonly string[]).includes(v)
const speakerOf = (v: unknown): TodaySpeaker => (v === 'owner' || v === 'kairos' ? v : 'agent')

function refOf(v: unknown): TodayRef | undefined {
  const r = asRecord(v)
  const ref: TodayRef = {}
  for (const k of ['threadId', 'memoryId', 'askId', 'dialogueId', 'jobId'] as const) {
    if (typeof r[k] === 'string' && r[k]) ref[k] = r[k] as string
  }
  if (typeof r.seq === 'number') ref.seq = r.seq
  return Object.keys(ref).length ? ref : undefined
}

export function toKairosTodayView(row: TodayRow): TodayEntryView {
  const p = asRecord(row.payload)
  const channel = isChannel(p.channel) ? p.channel : isChannel(row.toolName) ? row.toolName : 'kairos'
  const view: TodayEntryView = {
    at: row.createdAt.toISOString(),
    channel,
    type: isType(p.type) ? p.type : 'noted',
    speaker: speakerOf(p.speaker),
    relayed: p.relayedRole === 'operator',
    text: typeof p.text === 'string' ? p.text : '',
  }
  if (typeof p.tool === 'string') view.tool = p.tool
  if (typeof p.count === 'number') view.count = p.count
  if (typeof p.lastAt === 'string') view.lastAt = p.lastAt
  if (Array.isArray(p.samples)) {
    const samples = p.samples.filter((s): s is string => typeof s === 'string')
    if (samples.length) view.samples = samples
  }
  const ref = refOf(p.ref)
  if (ref) view.ref = ref
  return view
}

// Nightly trim (chat-distill cron). Mark what the distill run has consumed,
// then delete entries past the 36h window — only once consumed, or past the
// 72h hard stop regardless. userId narrows both to one user.
export async function markTodayConsumed(through: Date, userId?: string): Promise<number> {
  const where = [eq(agentSessions.engine, TODAY_ENGINE)]
  if (userId) where.push(eq(agentSessions.userId, userId))
  const rows = await db
    .update(agentSessions)
    .set({
      metadata: sql`coalesce(${agentSessions.metadata}, '{}'::jsonb) || jsonb_build_object('consumedThrough', ${through.toISOString()}::text)`,
      updatedAt: new Date(),
    })
    .where(and(...where))
    .returning({ id: agentSessions.id })
  return rows.length
}

export async function purgeTodayEntries(now: Date = new Date(), userId?: string): Promise<number> {
  const windowCutoff = new Date(now.getTime() - TODAY_RETENTION_HOURS * HOUR_MS)
  const hardCutoff = new Date(now.getTime() - TODAY_HARD_STOP_HOURS * HOUR_MS)
  const parentWhere = [eq(agentSessions.engine, TODAY_ENGINE)]
  if (userId) parentWhere.push(eq(agentSessions.userId, userId))
  const parents = db.select({ id: agentSessions.id }).from(agentSessions).where(and(...parentWhere))

  const consumed = sql`${sessionEvents.createdAt} <= (
    select (${agentSessions.metadata}->>'consumedThrough')::timestamp
    from ${agentSessions} where ${agentSessions.id} = ${sessionEvents.sessionId}
  )`

  const rows = await db
    .delete(sessionEvents)
    .where(and(
      eq(sessionEvents.kind, TODAY_EVENT_KIND),
      inArray(sessionEvents.sessionId, parents),
      lt(sessionEvents.createdAt, windowCutoff),
      or(lt(sessionEvents.createdAt, hardCutoff), consumed),
    ))
    .returning({ id: sessionEvents.id })
  return rows.length
}

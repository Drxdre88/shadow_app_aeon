import { createHash } from 'node:crypto'
import { after } from 'next/server'
import {
  countTodayEntries,
  listTodayEntries,
  todayWindow,
  toKairosTodayView,
  writeTodayEntry,
  type TodayClient,
  type TodayDigest,
  type TodayEntryPayload,
  type TodayRef,
  type TodayWriteMode,
} from '@/lib/data/kairos-today'
import {
  TODAY_GIST_MAX,
  TODAY_KEY_MAX,
  TODAY_MAX_LIST,
  TODAY_RETENTION_HOURS,
  TODAY_SAMPLE_MAX,
  TODAY_TEXT_MAX,
  type TodayChannel,
  type TodayCovered,
  type TodaySpeaker,
  type TodayType,
} from '@/lib/data/validators/kairos-today'
import type { Origin, OriginKind } from './origin'
import { sanitiseTodayText } from './today-render'

// ─────────────────────────────────────────────────────────────────────────
// Kairos "today" — the one-mind log (spec_one_mind, FIXED INTERFACE).
// Writers never throw and never block the caller's surface; readers return
// null when the feature is off or the read fails. Speaker is derived ONLY
// from the server-stamped origin — no input field can make an entry 'owner'.
// Flag: on unless KAIROS_TODAY === '0'.
// ─────────────────────────────────────────────────────────────────────────

export type { TodayChannel, TodayType, TodaySpeaker, TodayCovered } from '@/lib/data/validators/kairos-today'
export type { TodayClient, TodayRef, TodayEntryView, TodayDigest } from '@/lib/data/kairos-today'

export interface TodayEntryInput {
  key: string
  channel: TodayChannel
  type: TodayType
  text: string
  ref?: TodayRef
  covered?: TodayCovered | null
  relayedRole?: 'operator'
  client?: TodayClient
  tool?: string
}

const MCP_BUCKET_MS = 15 * 60_000
const MCP_THROTTLE_MS = 60_000
const MCP_THROTTLE_MAX = 500
const MAX_NOTES = 12
const SAMPLE_FIELDS = ['query', 'topic', 'q', 'question', 'title', 'name', 'content', 'text'] as const

export function todayEnabled(): boolean {
  return process.env.KAIROS_TODAY !== '0'
}

export function speakerForOrigin(kind: OriginKind): TodaySpeaker {
  if (kind === 'operator') return 'owner'
  if (kind === 'kairos') return 'kairos'
  return 'agent'
}

function buildPayload(entry: TodayEntryInput, origin: Origin): TodayEntryPayload {
  const speaker = speakerForOrigin(origin.kind)
  const max = entry.type === 'replied' ? TODAY_GIST_MAX : TODAY_TEXT_MAX
  const payload: TodayEntryPayload = {
    v: 1,
    key: String(entry.key).slice(0, TODAY_KEY_MAX),
    channel: entry.channel,
    type: entry.type,
    origin: origin.via ? { kind: origin.kind, via: origin.via } : { kind: origin.kind },
    speaker,
    text: sanitiseTodayText(String(entry.text ?? ''), max),
    covered: entry.covered ?? null,
  }
  if (entry.relayedRole === 'operator' && speaker === 'agent') payload.relayedRole = 'operator'
  if (entry.ref) payload.ref = entry.ref
  if (entry.client) payload.client = entry.client
  if (entry.tool) payload.tool = String(entry.tool).slice(0, 80)
  return payload
}

async function write(userId: string, payload: TodayEntryPayload, mode: TodayWriteMode): Promise<void> {
  try {
    await writeTodayEntry(userId, payload, mode)
  } catch (err) {
    console.warn('[kairos-today] write failed', {
      userId,
      key: payload.key,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function recordToday(userId: string, entry: TodayEntryInput, origin: Origin): Promise<void> {
  if (!todayEnabled() || !userId || !entry?.key) return
  try {
    await write(userId, buildPayload(entry, origin), 'upsert')
  } catch (err) {
    console.warn('[kairos-today] record failed', { userId, error: err instanceof Error ? err.message : String(err) })
  }
}

// Starts the write now (so ordering and timestamps match the event) and only
// uses after() to keep the function alive until it lands.
export function recordTodayAfter(userId: string, entry: TodayEntryInput, origin: Origin): void {
  if (!todayEnabled()) return
  const pending = recordToday(userId, entry, origin).catch(() => undefined)
  try {
    after(() => pending)
  } catch {
    // outside a request scope: the detached promise still completes
  }
}

function sampleOf(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const r = args as Record<string, unknown>
  for (const f of SAMPLE_FIELDS) {
    const v = r[f]
    if (typeof v === 'string' && v.trim()) return sanitiseTodayText(v, TODAY_SAMPLE_MAX)
  }
  return undefined
}

interface UseSlot {
  flushedAt: number
  pending: number
  samples: string[]
  inFlight: boolean
}

const useSlots = new Map<string, UseSlot>()

export function resetTodayUseThrottle(): void {
  useSlots.clear()
}

function slotFor(key: string): UseSlot {
  let slot = useSlots.get(key)
  if (!slot) {
    if (useSlots.size >= MCP_THROTTLE_MAX) {
      const oldest = useSlots.keys().next().value
      if (oldest !== undefined) useSlots.delete(oldest)
    }
    slot = { flushedAt: 0, pending: 0, samples: [], inFlight: false }
    useSlots.set(key, slot)
  }
  return slot
}

async function flushUse(userId: string, tool: string, client: TodayClient, slot: UseSlot): Promise<void> {
  const now = Date.now()
  const count = slot.pending
  const samples = slot.samples
  slot.pending = 0
  slot.samples = []
  slot.flushedAt = now
  const bucket = new Date(Math.floor(now / MCP_BUCKET_MS) * MCP_BUCKET_MS).toISOString()
  const who = client.label ? sanitiseTodayText(client.label, 60) : client.kind
  const payload = buildPayload(
    { key: `mcp:${client.fp}:${tool}:${bucket}`, channel: 'mcp', type: 'used', text: `${who} used ${tool}`, client, tool },
    { kind: 'agent', via: 'mcp' },
  )
  payload.count = count
  payload.lastAt = new Date(now).toISOString()
  if (samples.length) payload.samples = samples
  await write(userId, payload, 'coalesce')
}

// Calls inside the 60s window (or while a write is in flight) only bump an
// in-memory pending count; the next flush carries them, so a burst costs at
// most two short writes and the coalesced entry's count stays exact. Pending
// uses after the last flush wait for the next call on the same stream.
export async function noteMcpUse(userId: string, tool: string, args: unknown, client: TodayClient): Promise<void> {
  if (!todayEnabled() || !userId || !tool || !client?.fp) return
  try {
    const slot = slotFor(`${userId}:${tool}:${client.fp}`)
    slot.pending += 1
    const sample = sampleOf(args)
    if (sample && slot.samples.length < 3 && !slot.samples.includes(sample)) slot.samples.push(sample)
    if (slot.inFlight) return
    if (slot.flushedAt && Date.now() - slot.flushedAt < MCP_THROTTLE_MS) return
    slot.inFlight = true
    try {
      await flushUse(userId, tool, client, slot)
      if (slot.pending > 0) await flushUse(userId, tool, client, slot)
    } finally {
      slot.inFlight = false
    }
  } catch (err) {
    console.warn('[kairos-today] noteMcpUse failed', { userId, tool, error: err instanceof Error ? err.message : String(err) })
  }
}

function hash8(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

export async function appendTodayNotes(
  userId: string,
  notes: string[],
  source: 'pulse' | 'reflect',
  jobId?: string,
): Promise<void> {
  if (!todayEnabled() || !userId || !Array.isArray(notes)) return
  const origin: Origin = { kind: 'kairos', via: `thinking:${source}` }
  for (const note of notes.slice(0, MAX_NOTES)) {
    if (typeof note !== 'string' || !note.trim()) continue
    await recordToday(
      userId,
      {
        key: `note:${source}:${jobId ?? 'adhoc'}:${hash8(note)}`,
        channel: 'kairos',
        type: 'noted',
        text: note,
        ...(jobId ? { ref: { jobId } } : {}),
      },
      origin,
    )
  }
}

export async function countTodayEntriesSince(
  userId: string,
  since: Date,
  opts?: { speakers?: TodaySpeaker[] },
): Promise<number> {
  if (!todayEnabled()) return 0
  try {
    return await countTodayEntries(userId, since, opts?.speakers)
  } catch (err) {
    console.warn('[kairos-today] count failed', { userId, error: err instanceof Error ? err.message : String(err) })
    return 0
  }
}

export async function loadTodayDigest(
  userId: string,
  opts?: { hours?: number; excludeThreadId?: string; excludeTypes?: TodayType[]; channels?: TodayChannel[]; limit?: number },
): Promise<TodayDigest | null> {
  if (!todayEnabled() || !userId) return null
  const hours = Math.min(Math.max(opts?.hours ?? 24, 1), TODAY_RETENTION_HOURS)
  const limit = Math.min(Math.max(opts?.limit ?? 60, 1), TODAY_MAX_LIST)
  try {
    const now = new Date()
    const rows = await listTodayEntries(userId, {
      hours,
      limit,
      now,
      ...(opts?.channels?.length ? { channels: opts.channels } : {}),
      ...(opts?.excludeTypes?.length ? { excludeTypes: opts.excludeTypes } : {}),
      ...(opts?.excludeThreadId ? { excludeThreadId: opts.excludeThreadId } : {}),
    })
    const { from, to } = todayWindow(hours, now)
    return { entries: rows.map(toKairosTodayView), from: from.toISOString(), to: to.toISOString() }
  } catch (err) {
    console.warn('[kairos-today] digest failed', { userId, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

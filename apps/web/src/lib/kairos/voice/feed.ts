import { toSpeechText, VOICE_FEED_TEXT_MAX_CHARS } from './speech-text'

// The desk alert feed, pure half: which memories the voice line may read out
// and how. Only two sources ever qualify (Vorath's condition):
//   - Morghul relays: sourceMetadata.kind 'morghul_finding', or captured with
//     channel 'morghul' (captureMemory stores it as sourceMetadata.channel).
//     Rollups and digests are excluded; "needs you" and "resolved" pass.
//   - Vorath's own questions to the owner: open kairos asks, and speak
//     memories of kind 'question' (not ops alerts, digests or held speaks).
// Hourly reflections, briefs and ops alerts never qualify.

export type VoiceFeedKind = 'morghul' | 'question' | 'speak'
export type VoiceFeedUrgency = 'low' | 'normal' | 'high'

export interface VoiceFeedItem {
  id: string
  at: string
  kind: VoiceFeedKind
  title: string
  text: string
  urgency: VoiceFeedUrgency
  sourceId: string
}

export interface VoiceFeedRow {
  id: string
  title: string
  bodyMd: string
  summary: string | null
  type: string
  createdAt: Date
  sourceMetadata: Record<string, unknown> | null
}

export const VOICE_FEED_DEFAULT_WINDOW_MS = 15 * 60_000
export const VOICE_FEED_MAX_WINDOW_MS = 24 * 60 * 60_000
export const VOICE_FEED_DEFAULT_LIMIT = 20
export const VOICE_FEED_MAX_LIMIT = 50

const MORGHUL_EXCLUDED_TITLE = /\b(roll-?ups?|digests?)\b/i
const MORGHUL_EXCLUDED_KINDS = new Set(['digest', 'rollup', 'roll-up', 'morghul_rollup', 'morghul_digest'])
const NEEDS_YOU = /\bneeds you\b/i
const RESOLVED = /\bresolved\b/i
const URGENCIES = new Set<VoiceFeedUrgency>(['low', 'normal', 'high'])

const flag = (meta: Record<string, unknown>, key: string) => meta[key] === true || meta[key] === 'true'
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function urgencyOf(meta: Record<string, unknown>, fallback: VoiceFeedUrgency): VoiceFeedUrgency {
  const raw = str(meta.urgency).toLowerCase() as VoiceFeedUrgency
  return URGENCIES.has(raw) ? raw : fallback
}

export function isMorghulRelay(meta: Record<string, unknown>): boolean {
  return meta.kind === 'morghul_finding' || str(meta.channel).toLowerCase() === 'morghul'
}

function isMorghulRollup(row: VoiceFeedRow, meta: Record<string, unknown>): boolean {
  if (flag(meta, 'rollup') || flag(meta, 'digest')) return true
  const findingKind = str(meta.findingKind || meta.morghulKind).toLowerCase()
  if (MORGHUL_EXCLUDED_KINDS.has(findingKind)) return true
  return MORGHUL_EXCLUDED_TITLE.test(row.title)
}

function isOpenAsk(meta: Record<string, unknown>, now: Date): boolean {
  if (meta.kairosAskStatus !== 'pending') return false
  const expires = str(meta.expiresAt)
  return !expires || new Date(expires).getTime() > now.getTime()
}

function isSpokenQuestion(meta: Record<string, unknown>): boolean {
  return flag(meta, 'kairosSpeak')
    && meta.kind === 'question'
    && !flag(meta, 'opsAlert')
    && !flag(meta, 'digest')
    && meta.status !== 'held'
}

function speechOf(row: VoiceFeedRow): string {
  const body = row.bodyMd?.trim() ? row.bodyMd : row.summary ?? ''
  return toSpeechText(body, VOICE_FEED_TEXT_MAX_CHARS)
}

function item(row: VoiceFeedRow, kind: VoiceFeedKind, urgency: VoiceFeedUrgency, text: string): VoiceFeedItem {
  return {
    id: `${kind}:${row.id}`,
    at: row.createdAt.toISOString(),
    kind,
    title: toSpeechText(row.title, 160),
    text,
    urgency,
    sourceId: row.id,
  }
}

// One memory → a feed item, or null when the voice line must stay silent on it.
export function toVoiceFeedItem(row: VoiceFeedRow, now: Date = new Date()): VoiceFeedItem | null {
  const meta = row.sourceMetadata ?? {}
  if (row.type === 'reflection' || flag(meta, 'opsAlert')) return null
  if (isMorghulRelay(meta)) {
    if (isMorghulRollup(row, meta)) return null
    const fallback: VoiceFeedUrgency = NEEDS_YOU.test(row.title) ? 'high' : RESOLVED.test(row.title) ? 'low' : 'normal'
    return item(row, 'morghul', urgencyOf(meta, fallback), speechOf(row))
  }
  if (row.type === 'advisory' && isOpenAsk(meta, now)) {
    // An ask's question is its title; the body is rationale. Speak the question.
    return item(row, 'question', 'normal', toSpeechText(row.title, VOICE_FEED_TEXT_MAX_CHARS))
  }
  if (isSpokenQuestion(meta)) return item(row, 'speak', urgencyOf(meta, 'normal'), speechOf(row))
  return null
}

export interface VoiceFeedWindow {
  since: Date
  limit: number
}

export type VoiceFeedParams = { ok: true; window: VoiceFeedWindow } | { ok: false; error: string }

// `since` defaults to 15 minutes ago and is clamped to the last 24 hours;
// `limit` defaults to 20, capped at 50.
export function parseVoiceFeedParams(params: URLSearchParams, now: Date = new Date()): VoiceFeedParams {
  const rawSince = params.get('since')
  let since = new Date(now.getTime() - VOICE_FEED_DEFAULT_WINDOW_MS)
  if (rawSince) {
    const parsed = new Date(rawSince)
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'since must be an ISO timestamp' }
    since = parsed
  }
  const floor = new Date(now.getTime() - VOICE_FEED_MAX_WINDOW_MS)
  if (since < floor) since = floor
  const rawLimit = params.get('limit')
  let limit = VOICE_FEED_DEFAULT_LIMIT
  if (rawLimit) {
    const n = Number(rawLimit)
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'limit must be a positive integer' }
    limit = Math.min(n, VOICE_FEED_MAX_LIMIT)
  }
  return { ok: true, window: { since, limit } }
}

// Rows arrive oldest first, all strictly after `since`. `next` is the time of
// the last row examined (kept or dropped), so a page of dropped rows still
// moves the cursor forward; with no rows it stays at `since`.
export function buildVoiceFeed(
  rows: VoiceFeedRow[],
  window: VoiceFeedWindow,
  now: Date = new Date(),
): { items: VoiceFeedItem[]; next: string } {
  const items: VoiceFeedItem[] = []
  let cursor = window.since
  for (const row of rows) {
    if (items.length >= window.limit) break
    cursor = row.createdAt
    const found = toVoiceFeedItem(row, now)
    if (found) items.push(found)
  }
  return { items, next: cursor.toISOString() }
}

import type { GateLogEntry } from '@/lib/data/validators/kairos-gate'
import { isOwnerEntry, type GateTodayEntry } from './break'
import { foldObservations, sourceOf, type GateObservation } from './receptivity'
import { replyWarmth } from './reply-tone'

// Hourly receptivity fold. Speaks sent in (foldedThrough, now − 24h] become
// observations: replied (same 24h credit rule as the cadence), latency /
// channel / warmth from the owner's first today-log entry after the send
// (still inside the 36h retention), the London hour/day, kind, source and the
// gate's break reason. Idempotent through the watermark. lib/data is lazy.

const HOUR_MS = 3_600_000
const CREDIT_MS = 24 * HOUR_MS
const FIRST_FOLD_LOOKBACK_MS = 35 * HOUR_MS
const HELD_SLACK_MS = 6 * HOUR_MS

export interface FoldResult {
  folded: number
  through: string
}

type Meta = Record<string, unknown>
type OwnerEntry = GateTodayEntry & { text: string }

const record = (v: unknown): Meta => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Meta) : {})

function sentAtOf(createdAt: Date, meta: Meta): Date {
  const released = Date.parse(String(record(meta.gate).releasedAt ?? ''))
  return Number.isFinite(released) ? new Date(released) : createdAt
}

function breakTypeOf(memoryId: string, meta: Meta, log: readonly GateLogEntry[]): string {
  const released = record(meta.gate).releaseReason
  if (typeof released === 'string' && released) return released
  const logged = log.find((e) => e.memoryId === memoryId && e.decision !== 'release')
  return logged ? logged.reason : 'immediate'
}

export function buildObservation(
  row: { id: string; createdAt: Date; sourceMetadata: unknown },
  owner: readonly OwnerEntry[],
  log: readonly GateLogEntry[],
  repliedWithinCredit: (o: { createdAt: Date; sourceMetadata: unknown }) => boolean,
): GateObservation {
  const meta = record(row.sourceMetadata)
  const sentAt = sentAtOf(row.createdAt, meta)
  const replied = repliedWithinCredit({ createdAt: sentAt, sourceMetadata: row.sourceMetadata })
  const first = owner.find((e) => {
    const t = Date.parse(e.at)
    return t > sentAt.getTime() && t <= sentAt.getTime() + CREDIT_MS
  })
  const repliedAt = Date.parse(String(meta.repliedAt ?? ''))
  const latencyMs = first ? Date.parse(first.at) - sentAt.getTime() : Number.isFinite(repliedAt) ? repliedAt - sentAt.getTime() : null
  return {
    memoryId: row.id,
    sentAt,
    replied,
    latencyMin: latencyMs !== null && latencyMs >= 0 ? Math.round(latencyMs / 60_000) : null,
    warmth: replied && first?.type === 'said' ? replyWarmth(first.text) : null,
    replyChannel: replied && first ? first.channel : null,
    kind: meta.kind === 'question' ? 'question' : 'notify',
    source: sourceOf(meta.externalId),
    breakType: breakTypeOf(row.id, meta, log),
  }
}

export async function foldReceptivity(userId: string, now: Date): Promise<FoldResult | null> {
  const data = await import('@/lib/data/kairos-gate')
  const state = await data.readKairosGate(userId)
  const through = new Date(now.getTime() - CREDIT_MS)
  const mark = state.receptivity.foldedThrough
  const from = mark ? new Date(mark) : new Date(now.getTime() - FIRST_FOLD_LOOKBACK_MS)
  if (through.getTime() <= from.getTime()) return null

  const rows = (await data.listSpeaksForFold(userId, from, through, HELD_SLACK_MS)).filter((r) => {
    const t = sentAtOf(r.createdAt, record(r.sourceMetadata)).getTime()
    return t > from.getTime() && t <= through.getTime()
  })

  let observations: GateObservation[] = []
  if (rows.length > 0) {
    const [{ listTodayEntries, toKairosTodayView }, { repliedWithinCredit }] = await Promise.all([
      import('@/lib/data/kairos-today'),
      import('@/lib/kairos/engagement'),
    ])
    const entries = await listTodayEntries(userId, { hours: 36, limit: 200, now, excludeTypes: ['used'] })
    const owner = entries.map(toKairosTodayView).filter(isOwnerEntry)
    observations = rows.map((r) => buildObservation(r, owner, state.log, repliedWithinCredit))
  }

  return data.mutateKairosGate(userId, (s) => {
    const receptivity = foldObservations(s.receptivity, observations, through, now)
    if (receptivity === s.receptivity) return { state: null, result: null }
    return { state: { ...s, receptivity }, result: { folded: observations.length, through: through.toISOString() } }
  })
}

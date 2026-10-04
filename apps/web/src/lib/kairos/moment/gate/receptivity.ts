import {
  GATE_HALF_LIFE_DAYS,
  GATE_LOG_MAX,
  type GateCell,
  type GateCellView,
  type GateLogEntry,
  type GateReceptivity,
  type KairosGateState,
} from '@/lib/data/validators/kairos-gate'

// Receptivity map for the Kairos gate. Pure: the fold, decay, smoothing and
// the cold-hour test. Built from data already stored (speak rows + the today
// log); timing only, never prompt text.

const DAY_MS = 86_400_000
const PRIOR = 4
const COLD_MIN_N = 6
const GLOBAL_MIN_N = 10
const COLD_RATIO = 0.5

export type GateSource = 'agenda' | 'promise' | 'cold_read' | 'daily' | 'weekly' | 'external'

export interface GateObservation {
  memoryId: string
  sentAt: Date
  replied: boolean
  latencyMin: number | null
  warmth: number | null
  replyChannel: string | null
  kind: string
  source: GateSource
  breakType: string
}

export const emptyCell = (): GateCell => ({ n: 0, replied: 0, latSum: 0, latN: 0, warmSum: 0, warmN: 0 })

export function emptyReceptivity(): GateReceptivity {
  return { foldedThrough: null, updatedAt: null, global: emptyCell(), hour: {}, dow: {}, kind: {}, source: {}, breakType: {}, replyChannel: {} }
}

export const emptyGateState = (): KairosGateState => ({ v: 1, receptivity: emptyReceptivity(), log: [] })

const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function londonSlot(at: Date): { hour: number; dow: number } {
  const parts = LONDON.formatToParts(at)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const dow = DOW[parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0
  return { hour, dow }
}

export function sourceOf(externalId: unknown): GateSource {
  if (typeof externalId !== 'string') return 'external'
  if (externalId.startsWith('kairos-agenda:')) return 'agenda'
  if (externalId.startsWith('kairos-promise-nudge:')) return 'promise'
  if (externalId.startsWith('cold-read:')) return 'cold_read'
  if (externalId.startsWith('kairos-daily:')) return 'daily'
  if (externalId.startsWith('weekly-review:')) return 'weekly'
  return 'external'
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000

function scaleCell(c: GateCell, f: number): GateCell {
  return { n: r4(c.n * f), replied: r4(c.replied * f), latSum: r4(c.latSum * f), latN: r4(c.latN * f), warmSum: r4(c.warmSum * f), warmN: r4(c.warmN * f) }
}

const scaleRecord = (r: Record<string, GateCell>, f: number) => Object.fromEntries(Object.entries(r).map(([k, c]) => [k, scaleCell(c, f)]))

export function decayReceptivity(rec: GateReceptivity, now: Date): GateReceptivity {
  if (!rec.updatedAt) return rec
  const dt = now.getTime() - Date.parse(rec.updatedAt)
  if (!(dt > 0)) return rec
  const f = Math.pow(0.5, dt / (GATE_HALF_LIFE_DAYS * DAY_MS))
  return {
    ...rec,
    global: scaleCell(rec.global, f),
    hour: scaleRecord(rec.hour, f),
    dow: scaleRecord(rec.dow, f),
    kind: scaleRecord(rec.kind, f),
    source: scaleRecord(rec.source, f),
    breakType: scaleRecord(rec.breakType, f),
    replyChannel: Object.fromEntries(Object.entries(rec.replyChannel).map(([k, v]) => [k, r4(v * f)])),
  }
}

function addTo(c: GateCell | undefined, o: GateObservation): GateCell {
  const base = c ?? emptyCell()
  return {
    n: r4(base.n + 1),
    replied: r4(base.replied + (o.replied ? 1 : 0)),
    latSum: r4(base.latSum + (o.replied && o.latencyMin !== null ? o.latencyMin : 0)),
    latN: r4(base.latN + (o.replied && o.latencyMin !== null ? 1 : 0)),
    warmSum: r4(base.warmSum + (o.warmth ?? 0)),
    warmN: r4(base.warmN + (o.warmth === null ? 0 : 1)),
  }
}

const bump = (r: Record<string, GateCell>, key: string, o: GateObservation) => ({ ...r, [key]: addTo(r[key], o) })

// Idempotent: observations at or before the watermark are ignored and the
// watermark only moves forward.
export function foldObservations(rec: GateReceptivity, observations: readonly GateObservation[], through: Date, now: Date): GateReceptivity {
  const mark = rec.foldedThrough ? Date.parse(rec.foldedThrough) : -Infinity
  if (through.getTime() <= mark) return rec
  let next = decayReceptivity(rec, now)
  for (const o of observations) {
    const t = o.sentAt.getTime()
    if (t <= mark || t > through.getTime()) continue
    const { hour, dow } = londonSlot(o.sentAt)
    next = {
      ...next,
      global: addTo(next.global, o),
      hour: bump(next.hour, String(hour), o),
      dow: bump(next.dow, String(dow), o),
      kind: bump(next.kind, o.kind, o),
      source: bump(next.source, o.source, o),
      breakType: bump(next.breakType, o.breakType, o),
      replyChannel: o.replied && o.replyChannel ? { ...next.replyChannel, [o.replyChannel]: r4((next.replyChannel[o.replyChannel] ?? 0) + 1) } : next.replyChannel,
    }
  }
  return { ...next, foldedThrough: through.toISOString(), updatedAt: now.toISOString() }
}

const globalRate = (rec: GateReceptivity): number | null => (rec.global.n >= GLOBAL_MIN_N ? rec.global.replied / rec.global.n : null)

// Smoothed hour rate r_h = (replied_h + 4g) / (n_h + 4); cold when n_h ≥ 6 and r_h < 0.5·g.
export function isColdHour(rec: GateReceptivity, hour: number): boolean {
  const g = globalRate(rec)
  const cell = rec.hour[String(hour)]
  if (g === null || g <= 0 || !cell || cell.n < COLD_MIN_N) return false
  return (cell.replied + PRIOR * g) / (cell.n + PRIOR) < COLD_RATIO * g
}

export const isColdNow = (rec: GateReceptivity, now: Date): boolean => isColdHour(rec, londonSlot(now).hour)

export function appendGateLog(state: KairosGateState, entries: readonly GateLogEntry[]): KairosGateState {
  if (entries.length === 0) return state
  return { ...state, log: [...state.log, ...entries].slice(-GATE_LOG_MAX) }
}

// speakDelivered learns the memory id of the decision speakPolicy logged at the same instant.
export function attachLogMemoryId(state: KairosGateState, at: string, memoryId: string): KairosGateState | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!
    if (e.at === at && e.memoryId === null && e.decision !== 'release') {
      const log = [...state.log]
      log[i] = { ...e, memoryId }
      return { ...state, log }
    }
  }
  return null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function cellView(c: GateCell | undefined): GateCellView {
  const cell = c ?? emptyCell()
  return {
    n: r2(cell.n),
    replyRate: cell.n > 0 ? r2(cell.replied / cell.n) : null,
    avgLatencyMin: cell.latN > 0 ? Math.round(cell.latSum / cell.latN) : null,
    warmth: cell.warmN > 0 ? r2(cell.warmSum / cell.warmN) : null,
  }
}

import { originKindOf } from '@/lib/kairos/origin'

// Signal weights for the nightly activity score (living_dominions.md §1, set
// from the 30-day live-data recon). Every signal fades as exp(-ageDays/10).

export const WINDOW_DAYS = 30
export const DECAY_DAYS = 10
export const SESSION_WEIGHT = 2
export const NOTE_WEIGHT = 0.5
export const MAX_SESSIONS_PER_REPO_DAY = 10
export const MAX_CARD_EVENTS_PER_BOARD_DAY = 50

const DAY_MS = 86_400_000

export const CARD_WEIGHTS = {
  completed: 3,
  createdByOwner: 1,
  createdByAgent: 0.3,
  moved: 0.2,
  other: 0.1,
} as const

// Board-level housekeeping, not work on a card.
const NON_CARD_ENTITIES: ReadonlySet<string> = new Set(['project', 'column'])

export type CardEventSignal = {
  boardId: string
  entityType: string
  action: string
  actorType: string
  at: Date
}

export function cardEventWeight(e: Pick<CardEventSignal, 'entityType' | 'action' | 'actorType'>): number {
  if (NON_CARD_ENTITIES.has(e.entityType)) return 0
  if (e.action === 'completed') return CARD_WEIGHTS.completed
  if (e.action === 'created') return e.actorType === 'agent' ? CARD_WEIGHTS.createdByAgent : CARD_WEIGHTS.createdByOwner
  if (e.action === 'moved') return CARD_WEIGHTS.moved
  if (e.entityType === 'comment' && e.actorType === 'agent') return 0
  return CARD_WEIGHTS.other
}

export function ageDays(at: Date, now: Date): number {
  return Math.max(0, (now.getTime() - at.getTime()) / DAY_MS)
}

export function decay(at: Date, now: Date): number {
  return Math.exp(-ageDays(at, now) / DECAY_DAYS)
}

export function inWindow(at: Date, now: Date, windowDays = WINDOW_DAYS): boolean {
  return now.getTime() - at.getTime() <= windowDays * DAY_MS
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

// Raw memory row as read for scoring: only the provenance fields that decide
// whether it is a coding session, the owner's own note, or neither.
export type MemorySignalRow = {
  type: string
  source: string | null
  originKind: string | null
  metaKind: string | null
  repo: string | null
  dominionId: string | null
  createdAt: Date
}

export type MemorySignal =
  | { kind: 'session'; repo: string | null; at: Date }
  | { kind: 'note'; dominionId: string | null; at: Date }

const MACHINE_SOURCES: ReadonlySet<string> = new Set(['cron', 'system'])

// Session summaries count as coding sessions; the owner's hand-written notes
// count as notes. Machine-made memories (cron/system, Kairos, activity pages,
// agents) carry no signal about where the owner works.
export function classifyMemory(row: MemorySignalRow): MemorySignal | null {
  if (row.type === 'session_summary') return { kind: 'session', repo: row.repo, at: row.createdAt }
  if (row.source && MACHINE_SOURCES.has(row.source)) return null
  if (row.type === 'snapshot' || row.type === 'session_event') return null
  const sourceMetadata = {
    ...(row.originKind ? { origin: { kind: row.originKind } } : {}),
    ...(row.metaKind ? { kind: row.metaKind } : {}),
  }
  if (originKindOf({ source: row.source, sourceMetadata }) !== 'operator') return null
  return { kind: 'note', dominionId: row.dominionId, at: row.createdAt }
}

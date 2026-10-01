import { listRecentKairosAsks } from '@/lib/data/ask'
import { getLatestMindCompare, listBeliefs } from '@/lib/data/beliefs'
import { findDominionsByUser, listDominionObjectives } from '@/lib/data/dominions'
import { listPromotedBeliefsBetween } from '@/lib/data/memory-candidates'
import { listMemoryOps } from '@/lib/data/memory-ops'
import { findMemoryById, listMemories } from '@/lib/data/memories'
import { listTraceHistory } from '@/lib/data/recipes'
import { isoWeekKey, utcDayStart } from '@/lib/kairos/thinking/deadlines'

// Weekly review inputs (docs/kairos/34 §4): a FIXED set of read-only signals
// over the ISO week that just ended. Every source is optional — one failing
// query is recorded in `errors` and the review goes ahead on the rest.

const DAY_MS = 86_400_000
const MAX_TOP_TITLES = 5
const MAX_BOARD_PAGES = 30
const MAX_BELIEFS = 20
const MAX_PROMOTIONS = 5
const MAX_ASKS = 8
const MIND_COMPARE_MAX_AGE_DAYS = 14

export interface WeeklyReviewWindow {
  isoWeek: string
  start: Date
  end: Date
}

// The ISO week that ended at the most recent Monday 00:00Z at or before `now`.
export function reviewWindow(now: Date): WeeklyReviewWindow {
  const dayStart = utcDayStart(now)
  const sinceMonday = (now.getUTCDay() + 6) % 7
  const end = new Date(dayStart.getTime() - sinceMonday * DAY_MS)
  const start = new Date(end.getTime() - 7 * DAY_MS)
  return { isoWeek: isoWeekKey(start), start, end }
}

export interface BoardPageInput {
  id: string
  kind: 'board_day' | 'board_week'
  title: string
  label: string
  finished: number
  created: number | null
  stale: number | null
  topTitles: string[]
}

export interface ObjectiveInput {
  dominionId: string
  dominionName: string
  title: string
  status: string
  lastTouched: string
  targetDate: string | null
}

export interface BeliefChangeInput {
  id: string
  title: string
  change: 'created' | 'retired'
  mind: string | null
  domain: string | null
}

export interface MemoryOpsInput {
  total: number
  counts: Record<string, number>
  promotions: Array<{ memoryId: string; title: string }>
}

export interface MindCompareInput {
  id: string
  title: string
  summary: string | null
  createdAt: string
}

export interface AskInput {
  id: string
  title: string
  status: 'pending' | 'expired'
}

export interface HealthFailureInput {
  cronName: string
  failures: number
  reasons: string[]
}

export interface WeeklyReviewInputs {
  window: WeeklyReviewWindow
  dominions: Array<{ id: string; name: string }>
  boardPages: BoardPageInput[]
  objectives: ObjectiveInput[]
  beliefChanges: BeliefChangeInput[]
  memoryOps: MemoryOpsInput | null
  mindCompare: MindCompareInput | null
  asks: AskInput[]
  asksAnswered: number
  health: HealthFailureInput[]
  // Sources that failed to load (never fatal).
  errors: string[]
}

type Meta = Record<string, unknown>

function meta(value: unknown): Meta {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function inWindow(at: Date, w: WeeklyReviewWindow): boolean {
  return at.getTime() >= w.start.getTime() && at.getTime() < w.end.getTime()
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function safe<T>(name: string, errors: string[], fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200))
    return fallback
  }
}

// "- Finished: X" / "- Added: X" lines of a board_week page body.
function weekPageTitles(bodyMd: string): string[] {
  const out: string[] = []
  for (const line of bodyMd.split('\n')) {
    const m = line.match(/^- (?:Finished|Added): (.+)$/)
    if (m) out.push(m[1].trim())
    if (out.length >= MAX_TOP_TITLES) break
  }
  return out
}

async function gatherBoardPages(userId: string, w: WeeklyReviewWindow): Promise<BoardPageInput[]> {
  const rows = await listMemories(userId, { type: 'achievement', limit: 300 })
  const pages: BoardPageInput[] = []
  for (const row of rows) {
    if (!inWindow(row.createdAt, w)) continue
    const m = meta(row.sourceMetadata)
    if (m.kind === 'board_day') {
      const finished = Array.isArray(m.finished) ? m.finished : []
      pages.push({
        id: row.id,
        kind: 'board_day',
        title: row.title,
        label: str(m.date) ?? isoDay(row.createdAt),
        finished: finished.length,
        created: null,
        stale: null,
        topTitles: finished
          .map((c) => str(meta(c).title))
          .filter((t): t is string => t !== null)
          .slice(0, MAX_TOP_TITLES),
      })
    } else if (m.kind === 'board_week') {
      const counts = meta(m.counts)
      let topTitles: string[] = []
      try {
        const full = await findMemoryById(row.id, userId)
        topTitles = full ? weekPageTitles(full.bodyMd ?? '') : []
      } catch {
        topTitles = []
      }
      pages.push({
        id: row.id,
        kind: 'board_week',
        title: row.title,
        label: str(m.isoWeek) ?? isoDay(row.createdAt),
        finished: num(counts.finished) ?? 0,
        created: num(counts.created),
        stale: num(counts.untouched),
        topTitles,
      })
    }
  }
  pages.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return pages.slice(-MAX_BOARD_PAGES)
}

async function gatherObjectives(
  userId: string,
  dominions: Array<{ id: string; name: string }>,
  errors: string[],
): Promise<ObjectiveInput[]> {
  const out: ObjectiveInput[] = []
  for (const dom of dominions) {
    const rows = await safe(`objectives:${dom.name}`, errors, [], () => listDominionObjectives(dom.id, userId))
    for (const o of rows) {
      if (o.status !== 'active' && o.status !== 'paused') continue
      out.push({
        dominionId: dom.id,
        dominionName: dom.name,
        title: o.title,
        status: o.status,
        lastTouched: isoDay(o.updatedAt),
        targetDate: o.targetDate ? isoDay(o.targetDate) : null,
      })
    }
  }
  return out
}

async function gatherBeliefChanges(userId: string, w: WeeklyReviewWindow): Promise<BeliefChangeInput[]> {
  // A belief created or retired in the window was last touched at or after its start.
  const rows = await listBeliefs(userId, { status: 'all', updatedSince: w.start, limit: 200 })
  const out: BeliefChangeInput[] = []
  for (const b of rows) {
    const base = { id: b.id, title: b.claim, mind: b.mind, domain: b.domain }
    if (inWindow(b.createdAt, w)) out.push({ ...base, change: 'created' })
    else if (b.status === 'retired' && inWindow(b.updatedAt, w)) out.push({ ...base, change: 'retired' })
  }
  return out.slice(0, MAX_BELIEFS)
}

async function gatherMemoryOps(userId: string, w: WeeklyReviewWindow, errors: string[]): Promise<MemoryOpsInput | null> {
  const ops = await listMemoryOps(userId, { limit: 500, includeReverted: true })
  const counts: Record<string, number> = {}
  let total = 0
  for (const op of ops) {
    if (!inWindow(op.createdAt, w)) continue
    counts[op.op] = (counts[op.op] ?? 0) + 1
    total++
  }
  const promotions = await safe('promotions', errors, [], () =>
    listPromotedBeliefsBetween(userId, w.start, w.end, MAX_PROMOTIONS))
  if (total === 0 && promotions.length === 0) return null
  return { total, counts, promotions: promotions.map((p) => ({ memoryId: p.memoryId, title: p.title })) }
}

async function gatherMindCompare(userId: string, now: Date): Promise<MindCompareInput | null> {
  const hit = await getLatestMindCompare(userId)
  if (!hit || hit.createdAt.getTime() < now.getTime() - MIND_COMPARE_MAX_AGE_DAYS * DAY_MS) return null
  return { id: hit.id, title: hit.title, summary: hit.summary, createdAt: hit.createdAt.toISOString() }
}

async function gatherAsks(
  userId: string,
  w: WeeklyReviewWindow,
  now: Date,
): Promise<{ asks: AskInput[]; answered: number }> {
  const rows = await listRecentKairosAsks(userId, 14, now)
  const asks: AskInput[] = []
  let answered = 0
  for (const row of rows) {
    const status = row.kairosAsk.status
    if (status === 'answered') {
      if (inWindow(row.createdAt, w)) answered++
      continue
    }
    // Still-open asks always count; expired ones only if asked this week.
    if (status === 'pending' || inWindow(row.createdAt, w)) asks.push({ id: row.id, title: row.title, status })
  }
  return { asks: asks.slice(0, MAX_ASKS), answered }
}

async function gatherHealth(userId: string, w: WeeklyReviewWindow): Promise<HealthFailureInput[]> {
  const rows = await listTraceHistory(userId, { since: w.start, limit: 2000 })
  const byCron = new Map<string, { failures: number; reasons: Set<string> }>()
  for (const row of rows) {
    if (!inWindow(row.createdAt, w)) continue
    const m = meta(row.sourceMetadata)
    const reason = str(m.reason)
    // Success/skip traces carry no `reason` (lib/kairos/cron-trace.ts).
    if (!reason) continue
    const cron = str(m.cronName) ?? str(m.recipe) ?? 'unknown'
    const entry = byCron.get(cron) ?? { failures: 0, reasons: new Set<string>() }
    entry.failures++
    entry.reasons.add(reason.slice(0, 60))
    byCron.set(cron, entry)
  }
  return [...byCron.entries()]
    .map(([cronName, e]) => ({ cronName, failures: e.failures, reasons: [...e.reasons].slice(0, 3) }))
    .sort((a, b) => b.failures - a.failures || (a.cronName < b.cronName ? -1 : 1))
}

export async function gatherWeeklyReviewInputs(userId: string, now: Date): Promise<WeeklyReviewInputs> {
  const window = reviewWindow(now)
  const errors: string[] = []

  const dominions = await safe('dominions', errors, [], async () =>
    (await findDominionsByUser(userId)).filter((d) => !d.archivedAt).map((d) => ({ id: d.id, name: d.name })))

  const [boardPages, objectives, beliefChanges, memoryOps, mindCompare, asks, health] = await Promise.all([
    safe('board_pages', errors, [], () => gatherBoardPages(userId, window)),
    safe('objectives', errors, [], () => gatherObjectives(userId, dominions, errors)),
    safe('belief_changes', errors, [], () => gatherBeliefChanges(userId, window)),
    safe('memory_ops', errors, null, () => gatherMemoryOps(userId, window, errors)),
    safe('mind_compare', errors, null, () => gatherMindCompare(userId, now)),
    safe('asks', errors, { asks: [], answered: 0 }, () => gatherAsks(userId, window, now)),
    safe('health', errors, [], () => gatherHealth(userId, window)),
  ])

  return {
    window,
    dominions,
    boardPages,
    objectives,
    beliefChanges,
    memoryOps,
    mindCompare,
    asks: asks.asks,
    asksAnswered: asks.answered,
    health,
    errors,
  }
}

// Memory ids the model may cite as evidence. Dominion objectives live in their
// own table and health traces are bookkeeping, so neither is citable.
export function fedMemoryIds(inputs: WeeklyReviewInputs): string[] {
  const ids = new Set<string>()
  for (const p of inputs.boardPages) ids.add(p.id)
  for (const b of inputs.beliefChanges) ids.add(b.id)
  for (const p of inputs.memoryOps?.promotions ?? []) ids.add(p.memoryId)
  if (inputs.mindCompare) ids.add(inputs.mindCompare.id)
  for (const a of inputs.asks) ids.add(a.id)
  return [...ids]
}

export function hasReviewSignal(inputs: WeeklyReviewInputs): boolean {
  return (
    inputs.boardPages.length > 0 ||
    inputs.objectives.length > 0 ||
    inputs.beliefChanges.length > 0 ||
    inputs.memoryOps !== null ||
    inputs.mindCompare !== null ||
    inputs.asks.length > 0
  )
}

import { listRecentKairosAsks } from '@/lib/data/ask'
import { BELIEF_DIFF_ROW_CAP, listBeliefDiffOps, type BeliefDiffOpRow } from '@/lib/data/belief-diff'
import { getLatestMindCompare, listBeliefs } from '@/lib/data/beliefs'
import { findDominionsByUser, listDominionObjectives } from '@/lib/data/dominions'
import { goalStats, type GoalStats } from '@/lib/data/goals'
import { listIdeaOutcomes, listSurvivorsSince } from '@/lib/data/ideas'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { listPromotedBeliefsBetween } from '@/lib/data/memory-candidates'
import { listMemoryOps } from '@/lib/data/memory-ops'
import { findMemoryById, listMemories } from '@/lib/data/memories'
import { listTraceHistory } from '@/lib/data/recipes'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { weeklyIdeaDiversity } from '@/lib/kairos/ideas/diversity'
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
// Idea tournament (docs/kairos/35): ≤3 survivors a night → ≤21 a week.
const MAX_WEEK_SURVIVORS = 21
const IDEA_LESSON_DAYS = 30
const MAX_LESSONS_PER_OUTCOME = 8
// Belief diff (G13): the most significant changes shown, all counted.
export const MAX_BELIEF_DIFF_CHANGES = 15

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

export type IdeaWeekOutcome = 'accepted' | 'dismissed' | 'pending'

export interface IdeaSurvivorInput {
  id: string
  title: string
  claim: string
  direction: string
  survivedBecause: string | null
  elo: number | null
  tournamentDate: string
  outcome: IdeaWeekOutcome
}

export interface IdeasWeekInput {
  survivors: IdeaSurvivorInput[]
  diversity: { survivors: number; meanDistance: number | null; alarm: boolean } | null
}

export interface IdeaLessonInput {
  id: string
  title: string
  direction: string
  claim: string
}

// G11 "lessons": idea outcomes over the last IDEA_LESSON_DAYS.
export interface IdeaLessonsInput {
  days: number
  accepted: IdeaLessonInput[]
  dismissed: IdeaLessonInput[]
  acceptedCount: number
  dismissedCount: number
}

export type BeliefDiffKind =
  | 'created'
  | 'replaced'
  | 'retired'
  | 'reinforced'
  | 'flagged'
  | 'cleared'
  | 'normalised'
  | 'remapped'

export interface BeliefDiffChange {
  memoryId: string | null
  kind: BeliefDiffKind
  domain: string
  mind: string | null
  claim: string
  reason: string
  at: string
}

// G13 belief diff: every belief-ledger change in the window, counted; the
// MAX_BELIEF_DIFF_CHANGES most significant shown, grouped by domain.
export interface BeliefDiffInput {
  total: number
  counts: Partial<Record<BeliefDiffKind, number>>
  changes: BeliefDiffChange[]
  // The op read hit its row cap: counts are a lower bound.
  truncated: boolean
}

// Phase 2 initiative metrics — gathered only while KAIROS_INITIATIVE is on.
// goals: goals Kairos proposed in the last GOAL_STATS_DAYS days.
// promises: promises closed in the review window; lapsed and dropped both
// count as not kept.
export const GOAL_STATS_DAYS = 7

export interface PromiseWeekStats {
  kept: number
  lapsed: number
  dropped: number
  keptRate: number | null
}

export interface InitiativeWeekInput {
  goalDays: number
  goals: GoalStats | null
  promises: PromiseWeekStats | null
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
  // Optional so older fixtures stay valid; null/absent = unavailable or empty.
  ideas?: IdeasWeekInput | null
  ideaLessons?: IdeaLessonsInput | null
  beliefDiff?: BeliefDiffInput | null
  // Present only while the initiative switch is on.
  initiative?: InitiativeWeekInput | null
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
    if (status === 'dismissed') continue // the operator dropped it ("skip Q12")
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

// ── Ideas (docs/kairos/35, G11) ───────────────────────────────────────────

type IdeaOutcomeRows = Awaited<ReturnType<typeof listIdeaOutcomes>>

function survivorOutcome(id: string, status: string, outcomes: ReadonlyMap<string, 'accepted' | 'dismissed'>): IdeaWeekOutcome {
  const known = outcomes.get(id)
  if (known) return known
  if (status === 'accepted' || status === 'promoted') return 'accepted'
  return status === 'dismissed' ? 'dismissed' : 'pending'
}

async function gatherIdeasWeek(
  userId: string,
  w: WeeklyReviewWindow,
  outcomes: IdeaOutcomeRows | null,
  errors: string[],
): Promise<IdeasWeekInput | null> {
  const byId = new Map((outcomes ?? []).map((o) => [o.id, o.outcome]))
  const [rows, diversity] = await Promise.all([
    listSurvivorsSince(userId, w.start, MAX_WEEK_SURVIVORS),
    // The last instant of the reviewed week, so the reading is that week's.
    safe('idea_diversity', errors, null, async () => {
      const d = await weeklyIdeaDiversity(userId, new Date(w.end.getTime() - 1))
      return { survivors: d.survivors, meanDistance: d.meanDistance, alarm: d.alarm }
    }),
  ])
  const survivors = rows
    .filter((r) => inWindow(r.createdAt, w))
    .map((r) => ({
      id: r.id,
      title: r.title,
      claim: r.claim,
      direction: r.direction,
      survivedBecause: r.survivedBecause,
      elo: r.elo,
      tournamentDate: r.tournamentDate,
      outcome: survivorOutcome(r.id, r.status, byId),
    }))
  if (survivors.length === 0 && (!diversity || diversity.survivors === 0)) return null
  return { survivors, diversity }
}

function ideaLessonsFrom(outcomes: IdeaOutcomeRows | null): IdeaLessonsInput | null {
  if (!outcomes || outcomes.length === 0) return null
  const pick = (o: IdeaOutcomeRows[number]): IdeaLessonInput => ({ id: o.id, title: o.title, direction: o.direction, claim: o.claim })
  const accepted = outcomes.filter((o) => o.outcome === 'accepted')
  const dismissed = outcomes.filter((o) => o.outcome === 'dismissed')
  return {
    days: IDEA_LESSON_DAYS,
    accepted: accepted.slice(0, MAX_LESSONS_PER_OUTCOME).map(pick),
    dismissed: dismissed.slice(0, MAX_LESSONS_PER_OUTCOME).map(pick),
    acceptedCount: accepted.length,
    dismissedCount: dismissed.length,
  }
}

// ── Belief diff (G13) ─────────────────────────────────────────────────────

// How each belief-ledger op reads in the diff (op kinds: engine/types.ts;
// writers: lib/data/beliefs.ts, engine/steps/recheck.ts, own-mind mirror).
// null = not a belief change worth showing.
export function classifyBeliefOp(row: Pick<BeliefDiffOpRow, 'step' | 'op' | 'after'>): BeliefDiffKind | null {
  const after = row.after ?? {}
  if (row.step === 'recheck') {
    if (row.op === 'recheck') return 'flagged'
    if (row.op === 'retire') return 'retired'
    if (row.op === 'feedback') return after.normalised === true ? 'normalised' : 'remapped'
    return null
  }
  if (row.op === 'promote') return typeof after.supersedes === 'string' ? 'replaced' : 'created'
  if (row.op === 'feedback') return after.reaffirmed === true ? 'cleared' : 'reinforced'
  if (row.op === 'retire' || row.op === 'decay') return 'retired'
  return null
}

// Which changes win the MAX_BELIEF_DIFF_CHANGES slots: a changed mind first,
// bookkeeping last.
const DIFF_PRIORITY: Record<BeliefDiffKind, number> = {
  replaced: 0,
  retired: 1,
  flagged: 2,
  created: 3,
  cleared: 4,
  reinforced: 5,
  normalised: 6,
  remapped: 7,
}

export function buildBeliefDiff(rows: readonly BeliefDiffOpRow[], truncated: boolean): BeliefDiffInput | null {
  const counts: Partial<Record<BeliefDiffKind, number>> = {}
  const all: Array<BeliefDiffChange & { rank: number; seq: number }> = []
  rows.forEach((r, seq) => {
    const kind = classifyBeliefOp(r)
    if (!kind) return
    counts[kind] = (counts[kind] ?? 0) + 1
    all.push({
      memoryId: r.memoryId,
      kind,
      domain: str(r.domain) ?? 'general',
      mind: str(r.mind) ?? str(r.after?.mind),
      claim: str(r.claim) ?? '(belief no longer readable)',
      reason: r.reason,
      at: r.createdAt.toISOString(),
      rank: DIFF_PRIORITY[kind],
      seq,
    })
  })
  if (all.length === 0) return null
  // rows arrive newest first: within a kind, the newest win.
  const shown = [...all].sort((a, b) => a.rank - b.rank || a.seq - b.seq).slice(0, MAX_BELIEF_DIFF_CHANGES)
  shown.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : a.rank - b.rank || a.seq - b.seq))
  return {
    total: all.length,
    counts,
    changes: shown.map((c) => ({ memoryId: c.memoryId, kind: c.kind, domain: c.domain, mind: c.mind, claim: c.claim, reason: c.reason, at: c.at })),
    truncated,
  }
}

async function gatherBeliefDiff(userId: string, w: WeeklyReviewWindow): Promise<BeliefDiffInput | null> {
  const rows = await listBeliefDiffOps(userId, w.start, w.end)
  return buildBeliefDiff(rows, rows.length >= BELIEF_DIFF_ROW_CAP)
}

// ── Initiative metrics (Phase 2) ──────────────────────────────────────────

export function summarisePromiseWeek(
  closed: ReadonlyArray<{ status: string; closedAt?: string }>,
  w: WeeklyReviewWindow,
): PromiseWeekStats | null {
  let kept = 0
  let lapsed = 0
  let dropped = 0
  for (const p of closed) {
    const at = p.closedAt ? Date.parse(p.closedAt) : Number.NaN
    if (!Number.isFinite(at) || !inWindow(new Date(at), w)) continue
    if (p.status === 'kept') kept++
    else if (p.status === 'lapsed') lapsed++
    else if (p.status === 'dropped') dropped++
  }
  const total = kept + lapsed + dropped
  return total === 0 ? null : { kept, lapsed, dropped, keptRate: kept / total }
}

async function gatherInitiative(
  userId: string,
  w: WeeklyReviewWindow,
  now: Date,
  errors: string[],
): Promise<InitiativeWeekInput | null> {
  const [goals, promises] = await Promise.all([
    safe('goal_stats', errors, null, () => goalStats(userId, GOAL_STATS_DAYS, now)),
    safe('promise_stats', errors, null, async () => summarisePromiseWeek((await readKairosPromises(userId)).closed, w)),
  ])
  const hasGoals = goals !== null && goals.proposed > 0
  if (!hasGoals && !promises) return null
  return { goalDays: GOAL_STATS_DAYS, goals: hasGoals ? goals : null, promises }
}

export async function gatherWeeklyReviewInputs(userId: string, now: Date): Promise<WeeklyReviewInputs> {
  const window = reviewWindow(now)
  const errors: string[] = []

  const dominions = await safe('dominions', errors, [], async () =>
    (await findDominionsByUser(userId)).filter((d) => !d.archivedAt).map((d) => ({ id: d.id, name: d.name })))

  // One outcome read (30 days) serves both the week's survivors and the lessons.
  const outcomes = safe('idea_outcomes', errors, null, () => listIdeaOutcomes(userId, IDEA_LESSON_DAYS))

  const [boardPages, objectives, beliefChanges, memoryOps, mindCompare, asks, health, ideas, ideaLessons, beliefDiff, initiative] = await Promise.all([
    safe('board_pages', errors, [], () => gatherBoardPages(userId, window)),
    safe('objectives', errors, [], () => gatherObjectives(userId, dominions, errors)),
    safe('belief_changes', errors, [], () => gatherBeliefChanges(userId, window)),
    safe('memory_ops', errors, null, () => gatherMemoryOps(userId, window, errors)),
    safe('mind_compare', errors, null, () => gatherMindCompare(userId, now)),
    safe('asks', errors, { asks: [], answered: 0 }, () => gatherAsks(userId, window, now)),
    safe('health', errors, [], () => gatherHealth(userId, window)),
    safe('ideas', errors, null, async () => gatherIdeasWeek(userId, window, await outcomes, errors)),
    outcomes.then(ideaLessonsFrom),
    safe('belief_diff', errors, null, () => gatherBeliefDiff(userId, window)),
    initiativeEnabled() ? gatherInitiative(userId, window, now, errors) : Promise.resolve(null),
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
    ideas,
    ideaLessons,
    beliefDiff,
    ...(initiative ? { initiative } : {}),
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
  for (const s of inputs.ideas?.survivors ?? []) ids.add(s.id)
  for (const l of [...(inputs.ideaLessons?.accepted ?? []), ...(inputs.ideaLessons?.dismissed ?? [])]) ids.add(l.id)
  for (const c of inputs.beliefDiff?.changes ?? []) if (c.memoryId) ids.add(c.memoryId)
  return [...ids]
}

export function hasReviewSignal(inputs: WeeklyReviewInputs): boolean {
  return (
    inputs.boardPages.length > 0 ||
    inputs.objectives.length > 0 ||
    inputs.beliefChanges.length > 0 ||
    inputs.memoryOps !== null ||
    inputs.mindCompare !== null ||
    inputs.asks.length > 0 ||
    (inputs.ideas?.survivors.length ?? 0) > 0 ||
    (inputs.beliefDiff?.total ?? 0) > 0
  )
}

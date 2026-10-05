import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories } from '@/lib/db/schema'
import { getLatestAether } from '@/lib/data/aether'
import { notHeldSensitive } from '@/lib/kairos/sensitive/held'
import { listOpenKairosAsks } from '@/lib/data/ask'
import { listBoardDayPages } from '@/lib/data/board-feed'
import { listPromotedBeliefsBetween } from '@/lib/data/memory-candidates'
import { listTraceHistory } from '@/lib/data/recipes'
import { findLatestConscienceRun } from '@/lib/data/constitution-drift'
import { listSurvivorsSince } from '@/lib/data/ideas'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { readKairosAgenda } from '@/lib/data/kairos-agenda'
import { weeklyIdeaDiversity } from './ideas/diversity'
import { predictionsEnabled } from './predictions/flag'
import { agendaEnabled } from './agenda/flag'
import { loadTodayDigest } from './today'
import { loadStageBlock } from './stage'
import { gatherMomentDaily } from './moment'
import { summariseTodayForDaily, type AgendaDigest, type TodayDailyDigest, type VerdictDigest } from './daily-message-today'
import { pickAgenda, pickVerdicts } from './daily-message-tail'
import { getLatestDriftStatus } from './constitution/amendment'
import { conscienceFailureLine, readStoredConscience } from './constitution/conscience-probes'
import { SYNTHESIS_HEALTH_RECIPE } from './synthesis-health'
import { areaRowLimit, orderAreaRows } from './living/focus-areas'
import {
  MAX_DIGEST_BELIEFS,
  isLondonMonday,
  londonDate,
  londonInstant,
  previousDate,
  summariseSynthesis,
  type AetherDigest,
  type AreaDigest,
  type BeliefChange,
  type BoardDayDigest,
  type DailyMessageInputs,
  type DriftDigest,
  type GoalDigest,
  type IdeaOfTheDay,
  type OpenAskDigest,
  type PromisesDigest,
  type SynthesisSnapshot,
} from './daily-message-prompt'

// ─────────────────────────────────────────────────────────────────────────
// Daily message inputs (docs/kairos/34 §3). Each reader is independent and
// best-effort: a failure yields null for that input and its name in
// `failed`, never a failed message.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_LINE_CHARS = 200
const MAX_AREAS = 10
const MAX_NEW_BELIEFS = 5
const DRIFT_MAX_AGE_MS = 2 * DAY_MS
const MIND_COMPARE_MAX_AGE_MS = 8 * DAY_MS

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function clipLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_LINE_CHARS ? `${flat.slice(0, MAX_LINE_CHARS - 1)}…` : flat
}

// First meaningful lines of a markdown body: headings and section labels
// dropped, markdown emphasis/links/URLs stripped so they can't leak into the
// message.
export function firstPlainLines(bodyMd: string, max: number): string[] {
  const out: string[] = []
  for (const raw of bodyMd.split('\n')) {
    let line = raw.trim()
    if (!line || /^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line) || /^[-*_]{3,}$/.test(line)) continue
    line = line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[*_`]/g, '')
      .replace(/^[-•]\s+/, '')
      .trim()
    if (!line) continue
    out.push(clipLine(line))
    if (out.length >= max) break
  }
  return out
}

// Each live area's latest cortex headline (its `summary` = the cortex's
// visionAnchor, 1–2 sentences), newest area first (Living Dominions on: by
// activity rank, dormant left out). The nightly cortex replaced
// the per-area morning briefs as the "what matters in this area" input.
export async function readAreaHeadlines(userId: string): Promise<AreaDigest[]> {
  const rows = await db
    .select({
      dominionId: memories.dominionId, dominion: dominions.name, summary: memories.summary,
      focusState: dominions.focusState, pinned: dominions.pinned, activityScore: dominions.activityScore, sortOrder: dominions.sortOrder,
    })
    .from(memories)
    .innerJoin(dominions, eq(memories.dominionId, dominions.id))
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
      notHeldSensitive,
      isNull(dominions.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(areaRowLimit(MAX_AREAS * 3))
  const seen = new Set<string>()
  const out: AreaDigest[] = []
  for (const r of orderAreaRows(rows)) {
    // A pinned older cortex can sit beside tonight's: keep the newest only.
    if (!r.dominionId || seen.has(r.dominionId)) continue
    seen.add(r.dominionId)
    const headline = firstPlainLines(r.summary ?? '', 1)[0]
    if (headline) out.push({ dominion: clipLine(r.dominion), headline })
    if (out.length >= MAX_AREAS) break
  }
  return out
}

async function readAether(userId: string): Promise<AetherDigest[] | null> {
  const payload = await getLatestAether(userId)
  if (!payload || !Array.isArray(payload.thoughts)) return null
  return [...payload.thoughts]
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, 3)
    .map((t) => ({ title: clipLine(t.title), insight: clipLine(t.insight), dominionName: t.dominionName ?? null }))
}

async function readBoardDay(userId: string, date: string): Promise<BoardDayDigest | null> {
  const pages = await listBoardDayPages(userId, previousDate(date))
  if (pages.length === 0) return null
  let finished = 0
  let thinCards = 0
  const titles: string[] = []
  for (const page of pages) {
    const meta = asRecord(page.sourceMetadata) ?? {}
    const done = Array.isArray(meta.finished) ? meta.finished : []
    finished += done.length
    thinCards += Array.isArray(meta.thinCards) ? meta.thinCards.length : 0
    for (const card of done) {
      const title = asRecord(card)?.title
      if (typeof title === 'string' && title.trim() && titles.length < 3) titles.push(clipLine(title))
    }
  }
  return { finished, finishedTitles: titles, thinCards }
}

// New belief rows (either mind) since `since` — written by the beliefs lane
// (type 'belief', sourceMetadata.belief per docs/kairos/34 §1).
async function readNewBeliefs(userId: string, since: Date): Promise<BeliefChange[]> {
  const rows = await db
    .select({ title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'belief'),
      isNull(memories.archivedAt),
      notHeldSensitive,
      gte(memories.createdAt, since),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_NEW_BELIEFS)
  return rows.map((r) => {
    const belief = asRecord(asRecord(r.sourceMetadata)?.belief)
    const mind = belief?.mind === 'aligned' || belief?.mind === 'own' ? belief.mind : 'other'
    const claim = typeof belief?.claim === 'string' && belief.claim.trim() ? belief.claim : r.title
    return { mind, claim: clipLine(claim) }
  })
}

// The drift line plus the latest conscience checks (failures only, docs/kairos/34
// §2). `measured` is false when only conscience checks are fresh — there is
// then no drift verdict to report.
export interface DriftInputs extends DriftDigest {
  measured: boolean
  conscience: string | null
}

async function readConscience(userId: string, now: Date): Promise<string | null> {
  try {
    const row = await findLatestConscienceRun(userId)
    if (!row || now.getTime() - row.createdAt.getTime() > DRIFT_MAX_AGE_MS) return null
    const stored = readStoredConscience(row.sourceMetadata)
    return stored ? conscienceFailureLine(stored) : null
  } catch (err) {
    console.warn('[kairos:daily-message] conscience read failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function readDrift(userId: string, now: Date): Promise<DriftInputs | null> {
  const [status, conscience] = await Promise.all([getLatestDriftStatus(userId), readConscience(userId, now)])
  const fresh = status && now.getTime() - status.measuredAt.getTime() <= DRIFT_MAX_AGE_MS ? status : null
  if (!fresh) return conscience ? { alert: false, summary: null, measured: false, conscience } : null
  const flipped = fresh.flipped.slice(0, 2).map((f) => `"${clipLine(f.question)}"`)
  const summary = `mean similarity ${fresh.mean.toFixed(2)} to the v${fresh.version} baseline` +
    (flipped.length ? `; shifted most on ${flipped.join(' and ')}` : '')
  return { alert: fresh.alert, summary, measured: true, conscience }
}

async function readOpenAsks(userId: string, now: Date): Promise<OpenAskDigest[]> {
  const asks = await listOpenKairosAsks(userId, now)
  return asks.map((ask) => ({ seq: ask.seq, question: clipLine(ask.title), askedAt: ask.kairosAsk.askedAt || ask.createdAt.toISOString() }))
}

// The rollup counts only if it materialised on today's London date.
async function readSynthesis(userId: string, date: string): Promise<SynthesisSnapshot | null> {
  const [rollup] = await listTraceHistory(userId, { recipe: SYNTHESIS_HEALTH_RECIPE, limit: 1 })
  if (!rollup || londonDate(rollup.createdAt) !== date) return null
  const byStage = asRecord(asRecord(rollup.sourceMetadata)?.byStage)
  return byStage ? summariseSynthesis(byStage as Record<string, Record<string, 'ok' | 'failed'>>) : null
}

async function readMindCompare(userId: string, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ summary: memories.summary, bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      notHeldSensitive,
      sql`${memories.sourceMetadata}->>'kind' = 'mind_compare'`,
      gte(memories.createdAt, new Date(now.getTime() - MIND_COMPARE_MAX_AGE_MS)),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const text = row.summary?.trim() || firstPlainLines(row.bodyMd ?? '', 2).join(' ')
  return text ? clipLine(text) : null
}

// Idea tournament survivors since the previous message window (docs/kairos/35).
// One read of up to 3 survivors (highest Elo first); only those still pending
// in the inbox count: the first is the idea of the day, the rest "waiting".
const IDEA_PEEK = 3

async function readIdeaOfTheDay(userId: string, since: Date): Promise<IdeaOfTheDay | null> {
  const rows = (await listSurvivorsSince(userId, since, IDEA_PEEK)).filter((r) => r.status === 'pending')
  const top = rows[0]
  if (!top) return null
  const title = clipLine(top.title || top.claim)
  return {
    title,
    claim: clipLine(top.claim || top.title),
    survivedBecause: top.survivedBecause?.trim() ? clipLine(top.survivedBecause) : null,
    othersWaiting: rows.length - 1,
  }
}

async function readIdeaDiversityAlarm(userId: string, now: Date): Promise<boolean> {
  return (await weeklyIdeaDiversity(userId, now)).alarm === true
}

// Open promises plus any closed in the last day (kept / lapsed show once).
// null when there are none at all, so the input stays absent.
async function readPromises(userId: string, since: Date): Promise<PromisesDigest | null> {
  const state = await readKairosPromises(userId)
  const digest = (p: { seq: number; outcome: string; dueDate: string; status: PromisesDigest['open'][number]['status'] }) =>
    ({ seq: p.seq, outcome: clipLine(p.outcome), dueDate: p.dueDate, status: p.status })
  const closedSince = state.closed.filter((p) => p.closedAt && Date.parse(p.closedAt) >= since.getTime())
  if (state.open.length === 0 && closedSince.length === 0) return null
  return { open: state.open.map(digest), closedSince: closedSince.map(digest) }
}

// Kairos's open goals: unexpired proposals awaiting Approve / Veto and active
// goals. null when there are none, so the input stays absent.
async function readGoals(userId: string, now: Date): Promise<GoalDigest[] | null> {
  const goals = await listOpenGoals(userId, now)
  const out: GoalDigest[] = []
  for (const g of goals) {
    if (g.meta.state !== 'proposed' && g.meta.state !== 'active') continue
    out.push({ title: clipLine(g.title || g.meta.question), state: g.meta.state, dueAt: g.meta.dueAt, expiresAt: g.meta.expiresAt })
  }
  return out.length > 0 ? out : null
}

// The previous London day from the today log (owner statements, decisions,
// MCP use). The log keeps 36h, which covers the whole previous London day at
// 06:00. loadTodayDigest never throws (null when off or on a failed read).
const TODAY_LOOKBACK_HOURS = 36

async function readToday(userId: string, date: string): Promise<TodayDailyDigest | null> {
  // Two reads so a busy day of MCP use can't crowd the owner's words out of the window.
  const [words, use] = await Promise.all([
    loadTodayDigest(userId, { hours: TODAY_LOOKBACK_HOURS, limit: 200, excludeTypes: ['used', 'captured'] }),
    loadTodayDigest(userId, { hours: TODAY_LOOKBACK_HOURS, limit: 200, excludeTypes: ['said', 'replied', 'decided', 'answered', 'captured', 'spoke', 'voice_staged', 'voice_confirmed', 'noted'] }),
  ])
  if (!words && !use) return null
  return summariseTodayForDaily([...(words?.entries ?? []), ...(use?.entries ?? [])], londonInstant(previousDate(date), 0), londonInstant(date, 0))
}

async function readVerdicts(userId: string, now: Date): Promise<VerdictDigest[] | null> {
  if (!predictionsEnabled()) return null
  const picked = pickVerdicts((await readKairosPredictions(userId)).open, now)
  return picked.length > 0 ? picked : null
}

async function readAgenda(userId: string): Promise<AgendaDigest[] | null> {
  if (!agendaEnabled()) return null
  const picked = pickAgenda((await readKairosAgenda(userId)).open)
  return picked.length > 0 ? picked : null
}

async function safe<T>(name: string, failed: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.warn(`[kairos:daily-message] input ${name} failed:`, err instanceof Error ? err.message : err)
    failed.push(name)
    return null
  }
}

export async function gatherDailyMessageInputs(userId: string, now: Date): Promise<DailyMessageInputs> {
  const date = londonDate(now)
  const since = new Date(now.getTime() - DAY_MS)
  const isMonday = isLondonMonday(now)
  const failed: string[] = []
  const [areas, aether, boardDay, promotions, newBeliefs, drift, openAsks, synthesis, mindCompare, idea, ideaDiversityAlarm, promises, goals] = await Promise.all([
    safe('areas', failed, () => readAreaHeadlines(userId)),
    safe('aether', failed, () => readAether(userId)),
    safe('boardDay', failed, () => readBoardDay(userId, date)),
    safe('promotions', failed, () => listPromotedBeliefsBetween(userId, since, now, MAX_DIGEST_BELIEFS)),
    safe('newBeliefs', failed, () => readNewBeliefs(userId, since)),
    safe('drift', failed, () => readDrift(userId, now)),
    safe('openAsks', failed, () => readOpenAsks(userId, now)),
    safe('synthesis', failed, () => readSynthesis(userId, date)),
    isMonday ? safe('mindCompare', failed, () => readMindCompare(userId, now)) : Promise.resolve(null),
    safe('idea', failed, () => readIdeaOfTheDay(userId, since)),
    safe('ideaDiversity', failed, () => readIdeaDiversityAlarm(userId, now)),
    safe('promises', failed, () => readPromises(userId, since)),
    safe('goals', failed, () => readGoals(userId, now)),
  ])
  // One-mind inputs, after the batch above so they never reorder its reads.
  const [today, verdicts, agenda] = await Promise.all([
    safe('today', failed, () => readToday(userId, date)),
    safe('verdicts', failed, () => readVerdicts(userId, now)),
    safe('agenda', failed, () => readAgenda(userId)),
  ])
  // The stage block (KAIROS_STAGE=1). Never throws — '' when off or empty.
  const stage = (await loadStageBlock(userId, { now })).block
  // Wave 4 moment lanes (lib/kairos/moment). null when every lane is silent.
  const moment = await safe('moment', failed, () => gatherMomentDaily(userId, now))
  failed.sort()
  return {
    date, isMonday, areas, aether, boardDay, promotions, newBeliefs, drift, openAsks, synthesis, mindCompare, idea, ideaDiversityAlarm,
    ...(promises ? { promises } : {}),
    ...(goals ? { goals } : {}),
    ...(today ? { today } : {}),
    ...(verdicts ? { verdicts } : {}),
    ...(agenda ? { agenda } : {}),
    ...(stage ? { stage } : {}),
    ...(moment ? { moment } : {}),
    failed,
  }
}

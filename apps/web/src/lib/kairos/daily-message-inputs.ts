import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { getLatestAether } from '@/lib/data/aether'
import { getPendingKairosAsk } from '@/lib/data/ask'
import { listBoardDayPages } from '@/lib/data/board-feed'
import { listPromotedBeliefsBetween } from '@/lib/data/memory-candidates'
import { listTraceHistory } from '@/lib/data/recipes'
import { findLatestConscienceRun } from '@/lib/data/constitution-drift'
import { getLatestDriftStatus } from './constitution/amendment'
import { conscienceFailureLine, readStoredConscience } from './constitution/conscience-probes'
import { SYNTHESIS_HEALTH_RECIPE } from './synthesis-health'
import {
  MAX_DIGEST_BELIEFS,
  isLondonMonday,
  londonDate,
  previousDate,
  summariseSynthesis,
  type AetherDigest,
  type BeliefChange,
  type BoardDayDigest,
  type BriefDigest,
  type DailyMessageInputs,
  type DriftDigest,
  type SynthesisSnapshot,
} from './daily-message-prompt'

// ─────────────────────────────────────────────────────────────────────────
// Daily message inputs (docs/kairos/34 §3). Each reader is independent and
// best-effort: a failure yields null for that input and its name in
// `failed`, never a failed message.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_BRIEF_LINES = 2
const MAX_LINE_CHARS = 200
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

// First meaningful lines of a brief: headings and section labels dropped,
// markdown emphasis/links/URLs stripped so they can't leak into the message.
export function briefFirstLines(bodyMd: string, max: number = MAX_BRIEF_LINES): string[] {
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

// Brief titles are `${date} · ${Dominion} briefing` (recipes/brief.ts).
export function briefDominionName(title: string): string {
  const afterDate = title.includes(' · ') ? title.slice(title.indexOf(' · ') + 3) : title
  return afterDate.replace(/\s+briefing$/i, '').trim() || 'General'
}

export async function readTodayBriefs(userId: string, date: string): Promise<BriefDigest[]> {
  const rows = await db
    .select({ title: memories.title, bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'briefingDate' = ${date}`,
    ))
    .orderBy(memories.createdAt)
    .limit(10)
  return rows.map((r) => ({ dominion: briefDominionName(r.title), lines: briefFirstLines(r.bodyMd ?? '') }))
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

async function readPendingAsk(userId: string): Promise<string | null> {
  const ask = await getPendingKairosAsk(userId)
  if (!ask || ask.kairosAsk.status !== 'pending') return null
  return clipLine(ask.title)
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
      sql`${memories.sourceMetadata}->>'kind' = 'mind_compare'`,
      gte(memories.createdAt, new Date(now.getTime() - MIND_COMPARE_MAX_AGE_MS)),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const text = row.summary?.trim() || briefFirstLines(row.bodyMd ?? '', 2).join(' ')
  return text ? clipLine(text) : null
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
  const [briefs, aether, boardDay, promotions, newBeliefs, drift, pendingAsk, synthesis, mindCompare] = await Promise.all([
    safe('briefs', failed, () => readTodayBriefs(userId, date)),
    safe('aether', failed, () => readAether(userId)),
    safe('boardDay', failed, () => readBoardDay(userId, date)),
    safe('promotions', failed, () => listPromotedBeliefsBetween(userId, since, now, MAX_DIGEST_BELIEFS)),
    safe('newBeliefs', failed, () => readNewBeliefs(userId, since)),
    safe('drift', failed, () => readDrift(userId, now)),
    safe('pendingAsk', failed, () => readPendingAsk(userId)),
    safe('synthesis', failed, () => readSynthesis(userId, date)),
    isMonday ? safe('mindCompare', failed, () => readMindCompare(userId, now)) : Promise.resolve(null),
  ])
  failed.sort()
  return { date, isMonday, briefs, aether, boardDay, promotions, newBeliefs, drift, pendingAsk, synthesis, mindCompare, failed }
}

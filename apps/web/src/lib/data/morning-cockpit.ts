import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { listOpenKairosAsks } from '@/lib/data/ask'
import { listStaleTasks } from '@/lib/data/board-signals'
import { getKairosInbox, type KairosInboxProposal } from '@/lib/data/inbox'
import { listKairosPredictions } from '@/lib/data/kairos-predictions'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { listRepoPlaybooks, listSessionSummariesBetween } from '@/lib/data/repo-memory'
import { listAgentSessions } from '@/lib/data/sessions'
import { normalizeRepoSlug } from '@/lib/kairos/living/repo-slug'
import { heldSensitive } from '@/lib/kairos/sensitive/held'

// Morning cockpit (P3-3): the clickable version of the 06:00 message,
// assembled on every read from existing sources — never stored, no new jobs.
// Read-only and user-scoped; memory-backed rows held for the owner's review
// (private-topic hold) are dropped when their source does not already do so.

export const COCKPIT_CAP = 8
const STALE_SCAN = 50
const SESSION_SCAN = 100
const SLUG_SCAN = 200
const LESSON_TEXT_MAX = 160
const DAY_MS = 24 * 60 * 60 * 1000
const OVERNIGHT_HOUR = 18
const INTERNAL_ENGINE_PREFIX = 'kairos'

export interface CockpitSection<T> { count: number; items: T[] }

export interface CockpitPrediction { id: string; number: string; claim: string; probability: number; dueDate: string; needsVerdict: boolean; overdue: boolean }
export interface CockpitAsk { id: string; number: string; question: string; askedAt: string; expiresAt: string | null }
export interface CockpitPromise { id: string; number: string; outcome: string; dueDate: string; overdue: boolean; dueToday: boolean }
export interface CockpitProposal { id: string; kind: 'goal' | 'card_tree'; title: string; detail: string; projectId: string | null; projectName: string | null; expiresAt: string }
export interface CockpitStaleCard { taskId: string; name: string; projectId: string; projectName: string; columnName: string | null; ageDays: number }
export interface CockpitSession { id: string; engine: string; goal: string; status: string; repo: string | null; projectId: string | null; taskId: string | null; spawnedAt: string; endedAt: string | null }
export interface CockpitRepoLessons { id: string; slug: string; lessonCount: number; topLesson: string | null; updatedAt: string }

export interface MorningCockpit {
  generatedAt: string
  today: string
  since: string
  predictions: CockpitSection<CockpitPrediction>
  asks: CockpitSection<CockpitAsk>
  promises: CockpitSection<CockpitPromise>
  proposals: CockpitSection<CockpitProposal>
  staleCards: CockpitSection<CockpitStaleCard>
  sessions: CockpitSection<CockpitSession>
  repoLessons: CockpitSection<CockpitRepoLessons>
}

const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function londonParts(at: Date): Record<string, number> {
  const p: Record<string, number> = {}
  for (const part of LONDON_PARTS.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return p
}

export function londonToday(now: Date): string {
  const p = londonParts(now)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// 18:00 Europe/London on the previous London calendar day, as an instant.
export function overnightSince(now: Date): Date {
  const p = londonParts(now)
  const guess = Date.UTC(p.year, p.month - 1, p.day - 1, OVERNIGHT_HOUR)
  const w = londonParts(new Date(guess))
  const offset = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - guess
  return new Date(guess - offset)
}

const section = <T>(all: T[]): CockpitSection<T> => ({ count: all.length, items: all.slice(0, COCKPIT_CAP) })
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

async function heldMemoryIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, ids), heldSensitive))
  return new Set(rows.map((r) => r.id))
}

async function readPredictions(userId: string, today: string) {
  const { predictions } = await listKairosPredictions(userId, { scope: 'open' })
  const due = predictions
    .filter((p) => p.status === 'needs_verdict' || (p.status === 'open' && p.dueDate <= today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq)
  return section<CockpitPrediction>(due.map((p) => ({
    id: p.id, number: `R${p.seq}`, claim: p.claim, probability: p.probability, dueDate: p.dueDate,
    needsVerdict: p.status === 'needs_verdict', overdue: p.dueDate < today,
  })))
}

async function readPromises(userId: string, today: string) {
  const open = await listKairosPromises(userId, { scope: 'open' })
  const sorted = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq)
  return section<CockpitPromise>(sorted.map((p) => ({
    id: p.id, number: `P${p.seq}`, outcome: p.outcome, dueDate: p.dueDate, overdue: p.dueDate < today, dueToday: p.dueDate === today,
  })))
}

function toProposal(item: KairosInboxProposal): CockpitProposal | null {
  if (item.goal) return { id: item.id, kind: 'goal', title: item.title, detail: item.goal.question, projectId: null, projectName: null, expiresAt: item.goal.expiresAt }
  if (item.cardTree) {
    const t = item.cardTree
    return { id: item.id, kind: 'card_tree', title: item.title, detail: t.goal, projectId: t.projectId, projectName: t.projectName, expiresAt: t.expiresAt }
  }
  return null
}

async function readAsksAndProposals(userId: string, now: Date) {
  const [asks, inbox] = await Promise.all([listOpenKairosAsks(userId, now), getKairosInbox(userId, now)])
  const proposals = inbox.items.flatMap((i) => {
    const p = i.kind === 'proposal' ? toProposal(i) : null
    return p ? [p] : []
  })
  const held = await heldMemoryIds(userId, [...asks.map((a) => a.id), ...proposals.map((p) => p.id)])
  return {
    asks: section<CockpitAsk>(asks.filter((a) => !held.has(a.id)).map((a) => ({
      id: a.id, number: `Q${a.seq}`, question: a.title, askedAt: a.kairosAsk.askedAt, expiresAt: iso(a.expiresAt),
    }))),
    proposals: section(proposals.filter((p) => !held.has(p.id))),
  }
}

async function readStaleCards(userId: string) {
  const rows = await listStaleTasks({ userId, limit: STALE_SCAN })
  return section<CockpitStaleCard>(rows.map((r) => ({
    taskId: r.taskId, name: r.name, projectId: r.projectId, projectName: r.projectName, columnName: r.columnName, ageDays: r.ageDays,
  })))
}

async function readSessions(userId: string, since: Date): Promise<CockpitSession[]> {
  const rows = await listAgentSessions(userId, { since, liveOnly: false, limit: SESSION_SCAN, offset: 0 })
  return rows
    .filter((s) => !s.engine.toLowerCase().startsWith(INTERNAL_ENGINE_PREFIX))
    .map((s) => ({
      id: s.id, engine: s.engine, goal: s.goal, status: s.status, repo: s.repo, projectId: s.projectId, taskId: s.taskId,
      spawnedAt: s.spawnedAt.toISOString(), endedAt: iso(s.endedAt),
    }))
}

async function readRepoLessons(userId: string, since: Date, now: Date, sessions: CockpitSession[]) {
  const summaries = await listSessionSummariesBetween(userId, new Date(since.getTime() - DAY_MS), now, SLUG_SCAN)
  const slugs = new Set(summaries.map((s) => s.repo))
  for (const s of sessions) {
    const slug = normalizeRepoSlug(s.repo)
    if (slug) slugs.add(slug)
  }
  const playbooks = await listRepoPlaybooks(userId, [...slugs])
  const fresh = playbooks.filter((p) => p.playbook && p.playbook.lessons.length > 0 && p.updatedAt >= since)
  return section<CockpitRepoLessons>(fresh.map((p) => ({
    id: p.id, slug: p.slug || p.playbook!.repo, lessonCount: p.playbook!.lessons.length,
    topLesson: p.playbook!.lessons[0] ? clip(p.playbook!.lessons[0].text, LESSON_TEXT_MAX) : null,
    updatedAt: p.updatedAt.toISOString(),
  })))
}

export async function readMorningCockpit(userId: string, now: Date = new Date()): Promise<MorningCockpit> {
  const today = londonToday(now)
  const since = overnightSince(now)
  const [predictions, promises, asksAndProposals, staleCards, sessions] = await Promise.all([
    readPredictions(userId, today),
    readPromises(userId, today),
    readAsksAndProposals(userId, now),
    readStaleCards(userId),
    readSessions(userId, since),
  ])
  const repoLessons = await readRepoLessons(userId, since, now, sessions)
  return {
    generatedAt: now.toISOString(),
    today,
    since: since.toISOString(),
    predictions,
    asks: asksAndProposals.asks,
    promises,
    proposals: asksAndProposals.proposals,
    staleCards,
    sessions: section(sessions),
    repoLessons,
  }
}

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boardColumns, boardTasks, checklistItems, labels, projectMembers, projects, taskLabels } from '@/lib/db/schema'
import { listOpenKairosAsks } from '@/lib/data/ask'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { findRepoPlaybook, listRepoSessions, type RepoSessionRow } from '@/lib/data/repo-memory'
import { repoLabelNames, resolveRepo } from '@/lib/kairos/repo-memory/aliases'
import { buildStartHere } from '@/lib/kairos/repo-memory/render'
import type { RepoHandover, RepoHandoverCard, RepoHandoverSession } from '@/lib/kairos/repo-memory/types'
import { notArchivedSql } from './board-visibility'

// Repo handover, assembled on every read (never stored): the latest session
// summaries for the repo, open cards labelled repo:<label> on boards the
// user owns or belongs to, Vorath's open asks and promises, and the repo's
// lessons playbook. Read-only and user-scoped.

export const HANDOVER_SESSIONS = 3
export const HANDOVER_CARDS = 10
export const HANDOVER_ASKS = 5
export const HANDOVER_PROMISES = 5
const DONE_COLUMN_NAMES = ['done', 'vault']

const PRIORITY_RANK = sql<number>`case ${boardTasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`

function firstSentence(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  const cut = flat.match(/^(.{20,}?[.!?])(\s|$)/)
  const line = cut ? cut[1] : flat
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

function toSession(r: RepoSessionRow): RepoHandoverSession {
  const lead = r.summary?.trim() || r.body.split('\n').map((l) => l.replace(/\*\*|__|`/g, '').replace(/^[#>\-\s]+/, '').trim()).find((l) => l.length > 0) || ''
  return { id: r.id, date: r.createdAt.toISOString(), title: r.title, summary: firstSentence(lead), client: r.client }
}

export async function listRepoOpenCards(userId: string, labelNames: readonly string[], limit = HANDOVER_CARDS): Promise<RepoHandoverCard[]> {
  if (labelNames.length === 0) return []
  const member = sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${userId})`
  const rows = await db
    .select({
      id: boardTasks.id,
      name: boardTasks.name,
      priority: boardTasks.priority,
      boardId: projects.id,
      board: projects.name,
      column: boardColumns.name,
    })
    .from(boardTasks)
    .innerJoin(taskLabels, eq(taskLabels.taskId, boardTasks.id))
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, boardTasks.columnId))
    .where(and(
      sql`lower(trim(${labels.name})) in (${sql.join(labelNames.map((n) => sql`${n.toLowerCase()}`), sql`, `)})`,
      isNull(boardTasks.archivedAt),
      or(isNull(boardColumns.name), sql`lower(trim(${boardColumns.name})) not in (${sql.join(DONE_COLUMN_NAMES.map((n) => sql`${n}`), sql`, `)})`),
      or(eq(projects.userId, userId), member),
      notArchivedSql,
    ))
    .orderBy(PRIORITY_RANK, desc(boardTasks.updatedAt))
    .limit(limit * 3)
  const seen = new Set<string>()
  const cards = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, limit)
  if (cards.length === 0) return []
  const progress = await db
    .select({
      taskId: checklistItems.taskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${checklistItems.completed}))::int`,
    })
    .from(checklistItems)
    .where(inArray(checklistItems.taskId, cards.map((c) => c.id)))
    .groupBy(checklistItems.taskId)
  const byTask = new Map(progress.map((p) => [p.taskId, { done: Number(p.done), total: Number(p.total) }]))
  return cards.map((c) => ({ ...c, checklist: byTask.get(c.id) ?? { done: 0, total: 0 } }))
}

// null when the input names no repo at all.
export async function readRepoHandover(userId: string, input: { repo: string }, now: Date = new Date()): Promise<RepoHandover | null> {
  const repo = resolveRepo(input.repo)
  if (!repo) return null
  const [sessions, cards, asks, promises, playbook] = await Promise.all([
    listRepoSessions(userId, repo.slug, HANDOVER_SESSIONS),
    listRepoOpenCards(userId, repoLabelNames(repo)),
    listOpenKairosAsks(userId, now),
    listKairosPromises(userId, { scope: 'open' }),
    findRepoPlaybook(userId, repo.slug),
  ])
  const data = {
    repo: { slug: repo.slug, labels: repo.labels },
    assembledAt: now.toISOString(),
    sessions: sessions.map(toSession),
    cards,
    asks: asks.slice(0, HANDOVER_ASKS).map((a) => ({ label: `Q${a.seq}`, question: a.title, askedAt: a.kairosAsk.askedAt })),
    promises: promises.slice(0, HANDOVER_PROMISES).map((p) => ({ number: `P${p.seq}`, outcome: p.outcome, dueDate: p.dueDate })),
    playbook: playbook?.playbook
      ? { id: playbook.id, updatedAt: playbook.updatedAt.toISOString(), day: playbook.playbook.day, lessons: playbook.playbook.lessons }
      : null,
  }
  return { ...data, startHere: buildStartHere(data) }
}

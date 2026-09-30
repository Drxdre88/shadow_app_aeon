import { captureMemory } from '@/lib/data/memories'
import {
  listBoardColumnsForFeed,
  listBoardTasksActiveBetween,
  listBoardTasksByIds,
  listChecklistForTasks,
  listLabelNamesForTasks,
  listLiveBoardTasks,
  listTaskMoveEvents,
  listVaultedBetween,
  type FeedTaskRow,
  type FeedVaultRow,
} from '@/lib/data/board-feed'
import {
  buildBoardDayPage,
  buildBoardWeekPage,
  isoWeekLabel,
  type FeedCard,
  type KairosFeedMode,
} from './board-feed-render'

// ─────────────────────────────────────────────────────────────────────────
// Kairos board feed — "your board is the main feed". Runs inside the 23:00Z
// project-snapshot cron for projects whose settings.kairosFeed is set:
//   daily  → one durable board_day page per board per UTC day
//   weekly → one board_week milestone page per board, Mondays only
// Pages are type 'achievement' / streamClass 'agentic' — the operator's own
// work record, so they sit in chat's retrieval substrate (reflection / idea /
// agentic). Deliberately NOT 'snapshot', so the ephemeral TTL sweep never
// archives them, and not 'execution', which chat retrieval never reads.
//
// Window: the rolling 24h (or 7d) ending at the cron run, not the calendar
// day, so the 23:00–24:00 hour is never lost between consecutive runs.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const UNTOUCHED_DAYS = 30

export interface FeedProject {
  id: string
  name: string
  dominionId: string | null
}

export interface BoardFeedResult {
  mode: KairosFeedMode
  status: 'created' | 'existing' | 'skipped'
  reason?: string
  externalId?: string
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS))
}

function inWindow(date: Date | null, start: Date, end: Date): date is Date {
  return !!date && date.getTime() >= start.getTime() && date.getTime() < end.getTime()
}

/** Attach checklist + labels to board rows. */
export async function toFeedCards(
  tasks: FeedTaskRow[],
  at: (task: FeedTaskRow) => Date,
  columnNames: Map<string, string> = new Map(),
): Promise<FeedCard[]> {
  if (tasks.length === 0) return []
  const ids = tasks.map((task) => task.id)
  const [checklist, labelRows] = await Promise.all([listChecklistForTasks(ids), listLabelNamesForTasks(ids)])
  return tasks.map((task) => {
    const items = checklist
      .filter((item) => item.taskId === task.id)
      .map((item) => ({ title: item.title, done: item.completed || item.state === 'checked' }))
    return {
      taskId: task.id,
      title: task.name,
      description: task.description,
      checklist: { done: items.filter((item) => item.done).length, total: items.length, items },
      labels: labelRows.filter((row) => row.taskId === task.id).map((row) => row.name),
      daysTaken: task.completedAt ? daysBetween(task.startedAt ?? task.createdAt, task.completedAt) : null,
      columnName: task.columnId ? (columnNames.get(task.columnId) ?? null) : null,
      at: at(task),
    }
  })
}

function vaultLabels(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return []
  return snapshot.flatMap((entry) => (
    entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
      ? [(entry as { name: string }).name]
      : []
  ))
}

function vaultChecklist(snapshot: unknown): FeedCard['checklist'] {
  const raw = (snapshot && typeof snapshot === 'object' ? snapshot : {}) as Record<string, unknown>
  const total = typeof raw.total === 'number' ? raw.total : 0
  const done = typeof raw.checked === 'number' ? raw.checked : 0
  return { done, total, items: [] }
}

export function vaultToFeedCard(row: FeedVaultRow): FeedCard {
  return {
    vaultId: row.id,
    title: row.name,
    description: row.description,
    checklist: vaultChecklist(row.checklistSnapshot),
    labels: vaultLabels(row.labelSnapshot),
    daysTaken: row.daysTaken,
    columnName: row.columnName,
    at: row.archivedAt,
  }
}

function moveTarget(metadata: unknown): string | null {
  const raw = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>
  return typeof raw.toColumnId === 'string' ? raw.toColumnId : null
}

async function writeBoardDayPage(userId: string, project: FeedProject, now: Date): Promise<BoardFeedResult> {
  const date = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - DAY_MS)
  const externalId = `board-day:${project.id}:${date}`

  const [touched, moves, vaulted, columns] = await Promise.all([
    listBoardTasksActiveBetween(project.id, start, now),
    listTaskMoveEvents(project.id, start, now),
    listVaultedBetween(project.id, start, now),
    listBoardColumnsForFeed(project.id),
  ])
  const columnNames = new Map(columns.map((column) => [column.id, column.name]))

  const finishedRows = touched.filter((task) => task.status === 'done' && inWindow(task.completedAt, start, now))
  const finishedIds = new Set(finishedRows.map((task) => task.id))
  const vaultedCards = vaulted
    .filter((row) => !row.originalTaskId || !finishedIds.has(row.originalTaskId))
    .map(vaultToFeedCard)
  vaulted.forEach((row) => { if (row.originalTaskId) finishedIds.add(row.originalTaskId) })

  const createdRows = touched.filter((task) => !finishedIds.has(task.id) && inWindow(task.createdAt, start, now))
  const createdIds = new Set(createdRows.map((task) => task.id))

  // Started: first move into in-progress, or a column move (latest wins).
  const started = new Map<string, { taskId: string; title: string; columnName: string | null }>()
  const movedMissing: string[] = []
  for (const move of moves) {
    if (finishedIds.has(move.taskId) || started.has(move.taskId)) continue
    const toColumn = moveTarget(move.metadata)
    started.set(move.taskId, {
      taskId: move.taskId,
      title: move.taskName ?? '',
      columnName: toColumn ? (columnNames.get(toColumn) ?? null) : null,
    })
    if (!move.taskName) movedMissing.push(move.taskId)
  }
  for (const task of touched) {
    if (finishedIds.has(task.id) || started.has(task.id) || !inWindow(task.startedAt, start, now)) continue
    started.set(task.id, {
      taskId: task.id,
      title: task.name,
      columnName: task.columnId ? (columnNames.get(task.columnId) ?? null) : null,
    })
  }
  if (movedMissing.length > 0) {
    const named = await listBoardTasksByIds(project.id, movedMissing)
    for (const task of named) {
      const entry = started.get(task.id)
      if (entry) entry.title = task.name
    }
  }
  // A card created today and dragged around is intent, not a start.
  for (const id of createdIds) started.delete(id)

  const [finishedCards, createdCards] = await Promise.all([
    toFeedCards(finishedRows, (task) => task.completedAt ?? now, columnNames),
    toFeedCards(createdRows, (task) => task.createdAt, columnNames),
  ])

  const page = buildBoardDayPage({
    projectName: project.name,
    date,
    finished: [...finishedCards, ...vaultedCards],
    started: [...started.values()].filter((entry) => entry.title.trim().length > 0),
    created: createdCards,
  })
  if (!page) return { mode: 'daily', status: 'skipped', reason: 'quiet_day' }

  const { created } = await captureMemory(userId, {
    title: page.title,
    bodyMd: page.bodyMd,
    type: 'achievement',
    streamClass: 'agentic',
    source: 'cron',
    projectId: project.id,
    dominionId: project.dominionId,
    sourceMetadata: {
      externalId,
      kind: 'board_day',
      projectId: project.id,
      date,
      finished: page.finished,
      thinCards: page.thinCards,
    },
  })
  return { mode: 'daily', status: created ? 'created' : 'existing', externalId }
}

async function writeBoardWeekPage(userId: string, project: FeedProject, now: Date): Promise<BoardFeedResult> {
  if (now.getUTCDay() !== 1) return { mode: 'weekly', status: 'skipped', reason: 'not_monday' }
  const isoWeek = isoWeekLabel(now)
  const start = new Date(now.getTime() - 7 * DAY_MS)
  const externalId = `board-week:${project.id}:${isoWeek}`

  const [columns, live, moves, vaulted] = await Promise.all([
    listBoardColumnsForFeed(project.id),
    listLiveBoardTasks(project.id),
    listTaskMoveEvents(project.id, start, now),
    listVaultedBetween(project.id, start, now),
  ])
  const columnNames = new Map(columns.map((column) => [column.id, column.name]))
  const cards = await toFeedCards(live, (task) => task.updatedAt, columnNames)
  const cardById = new Map(cards.map((card) => [card.taskId!, card]))

  const columnSections = columns.map((column) => ({
    name: column.name,
    cards: live.filter((task) => task.columnId === column.id).map((task) => cardById.get(task.id)!),
  }))
  const orphans = live.filter((task) => !task.columnId || !columnNames.has(task.columnId))
  if (orphans.length > 0) {
    columnSections.push({ name: 'No column', cards: orphans.map((task) => cardById.get(task.id)!) })
  }

  const finished = [
    ...cards.filter((card) => {
      const task = live.find((row) => row.id === card.taskId)
      return !!task && task.status === 'done' && inWindow(task.completedAt, start, now)
    }).map((card) => ({ ...card, at: live.find((row) => row.id === card.taskId)!.completedAt! })),
    ...vaulted.map(vaultToFeedCard),
  ]
  const created = live
    .filter((task) => inWindow(task.createdAt, start, now))
    .map((task) => ({ ...cardById.get(task.id)!, at: task.createdAt }))
  const seenMoves = new Set<string>()
  const moved = moves.flatMap((move) => {
    if (seenMoves.has(move.taskId)) return []
    seenMoves.add(move.taskId)
    const title = move.taskName ?? cardById.get(move.taskId)?.title
    if (!title) return []
    const toColumn = moveTarget(move.metadata)
    return [{ title, columnName: toColumn ? (columnNames.get(toColumn) ?? null) : null }]
  })
  const untouchedCutoff = now.getTime() - UNTOUCHED_DAYS * DAY_MS
  const untouched = live
    .filter((task) => task.status !== 'done' && task.updatedAt.getTime() < untouchedCutoff)
    .map((task) => ({
      title: task.name,
      columnName: task.columnId ? (columnNames.get(task.columnId) ?? null) : null,
      days: Math.floor((now.getTime() - task.updatedAt.getTime()) / DAY_MS),
    }))

  const page = buildBoardWeekPage({
    projectName: project.name,
    isoWeek,
    columns: columnSections,
    finished,
    created,
    moved,
    untouched,
  })
  if (!page) return { mode: 'weekly', status: 'skipped', reason: 'empty_board' }

  const { created: wasCreated } = await captureMemory(userId, {
    title: page.title,
    bodyMd: page.bodyMd,
    type: 'achievement',
    streamClass: 'agentic',
    source: 'cron',
    projectId: project.id,
    dominionId: project.dominionId,
    sourceMetadata: {
      externalId,
      kind: 'board_week',
      projectId: project.id,
      isoWeek,
      counts: {
        live: live.length,
        finished: finished.length,
        created: created.length,
        moved: moved.length,
        untouched: untouched.length,
      },
    },
  })
  return { mode: 'weekly', status: wasCreated ? 'created' : 'existing', externalId }
}

export async function runBoardFeedForProject(
  userId: string,
  project: FeedProject,
  mode: KairosFeedMode,
  now: Date = new Date(),
): Promise<BoardFeedResult> {
  return mode === 'daily'
    ? writeBoardDayPage(userId, project, now)
    : writeBoardWeekPage(userId, project, now)
}

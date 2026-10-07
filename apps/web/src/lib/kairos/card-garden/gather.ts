import { listStaleTasks } from '@/lib/data/board-signals'
import { listRecentCardGardenTaskIds } from '@/lib/data/card-garden-proposals'
import { findColumns } from '@/lib/data/columns'
import { canEditProject } from '@/lib/data/hangar-access'
import { getColumnDwellTimes } from '@/lib/data/velocity'
import type { CardGardenJobBoard, CardGardenJobCard } from './prompt'
import { CARD_GARDEN_MAX_CANDIDATES, CARD_GARDEN_STALE_DAYS, pickDoneColumn, pickParkColumn } from './types'

// The week's candidates: open cards untouched for CARD_GARDEN_STALE_DAYS on
// boards the owner can edit, not already sitting in a backlog-like or done
// column, and not raised by the gardener in the last four weeks. Capped at
// CARD_GARDEN_MAX_CANDIDATES, stalest first, with each board's columns and
// recent column dwell.

const STALE_SCAN_LIMIT = 120
const RECENT_WINDOW_MS = 28 * 24 * 60 * 60 * 1000

export interface CardGardenCandidates {
  boards: CardGardenJobBoard[]
  cards: CardGardenJobCard[]
}

async function soft<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch (err) {
    console.warn(`[kairos:card-garden] ${label} read failed:`, err instanceof Error ? err.message : String(err))
    return fallback
  }
}

export async function gatherCardGardenCandidates(userId: string, now: Date): Promise<CardGardenCandidates> {
  const [stale, recent] = await Promise.all([
    listStaleTasks({ userId, days: CARD_GARDEN_STALE_DAYS, limit: STALE_SCAN_LIMIT }),
    listRecentCardGardenTaskIds(userId, new Date(now.getTime() - RECENT_WINDOW_MS)),
  ])
  const boards = new Map<string, CardGardenJobBoard | null>()
  const cards: CardGardenJobCard[] = []
  const seen = new Set<string>()

  for (const task of stale) {
    if (cards.length >= CARD_GARDEN_MAX_CANDIDATES) break
    if (seen.has(task.taskId) || recent.has(task.taskId)) continue
    seen.add(task.taskId)
    if (task.columnName && (pickParkColumn([{ name: task.columnName }]) || pickDoneColumn([{ name: task.columnName }]))) continue
    if (!boards.has(task.projectId)) boards.set(task.projectId, await readBoard(userId, task.projectId, task.projectName))
    const board = boards.get(task.projectId)
    if (!board) continue
    cards.push({
      taskId: task.taskId,
      name: task.name,
      projectId: task.projectId,
      columnName: task.columnName,
      ageDays: Math.max(0, Number(task.ageDays) || 0),
      priority: task.priority,
    })
  }
  const used = new Set(cards.map((c) => c.projectId))
  return { boards: [...boards.values()].filter((b): b is CardGardenJobBoard => b !== null && used.has(b.projectId)), cards }
}

// Null when the owner cannot edit the board (viewer, or access gone).
async function readBoard(userId: string, projectId: string, projectName: string): Promise<CardGardenJobBoard | null> {
  if (!(await canEditProject(projectId, userId))) return null
  const [columns, dwell] = await Promise.all([
    findColumns(projectId),
    soft('column dwell', getColumnDwellTimes(projectId, '30d'), []),
  ])
  return {
    projectId,
    projectName,
    columns: columns.map((c) => c.name),
    parkColumn: pickParkColumn(columns)?.name ?? null,
    doneColumn: pickDoneColumn(columns)?.name ?? null,
    dwell: dwell.map((d) => ({ column: d.column, avgHours: d.avgHours })),
  }
}

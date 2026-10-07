import { db } from '@/lib/db'
import { boardColumns, boardTasks } from '@/lib/db/schema'
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { verifyProjectAccess } from './projects'
import { getColumnDwellTimes } from './velocity'
import { forecastBoard, FORECAST_WINDOW_DAYS, type CardForecast } from '@/lib/schedule/forecast'

// Board-level card forecasts, worked out on every read (P3-2). Reads the
// cached Chronos computedEnd and the last 30 days of column dwell; writes
// nothing and never runs the solver, so a read cannot move the schedule.

export interface BoardForecast {
  projectId: string
  generatedAt: string
  windowDays: number
  forecasts: CardForecast[]
}

/** Null when the user cannot see the project. */
export async function readCardForecasts(
  projectId: string,
  userId: string,
  { taskId, now = new Date() }: { taskId?: string; now?: Date } = {},
): Promise<BoardForecast | null> {
  if (!(await verifyProjectAccess(projectId, userId))) return null

  const taskConditions = [
    eq(boardTasks.projectId, projectId),
    isNull(boardTasks.archivedAt),
    ne(boardTasks.status, 'done'),
    or(isNotNull(boardTasks.endDate), isNotNull(boardTasks.estimateMinutes)),
  ]
  if (taskId) taskConditions.push(eq(boardTasks.id, taskId))

  const [columns, tasks, dwell] = await Promise.all([
    db
      .select({ id: boardColumns.id, name: boardColumns.name, orderIndex: boardColumns.orderIndex })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId)),
    db
      .select({
        id: boardTasks.id,
        columnId: boardTasks.columnId,
        endDate: boardTasks.endDate,
        estimateMinutes: boardTasks.estimateMinutes,
        computedEnd: boardTasks.computedEnd,
      })
      .from(boardTasks)
      .where(and(...taskConditions)),
    getColumnDwellTimes(projectId, '30d'),
  ])

  return {
    projectId,
    generatedAt: now.toISOString(),
    windowDays: FORECAST_WINDOW_DAYS,
    forecasts: forecastBoard(tasks, { columns, dwell, now }),
  }
}

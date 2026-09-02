/**
 * Chronos adapter — the only place a board row becomes a `ScheduleTask`.
 *
 * Pure by the same contract as the solver (CHR-3): structural row shapes in,
 * engine types out, no db import, no clock. The data layer selects the columns;
 * this file decides what they mean.
 *
 * Sizing reconciliation. The board's sizing config (`components/board/sizing.ts`)
 * is `{ enabled, unit, labels }` and has no hours-per-point; the engine's
 * `BoardSizing` is `{ unit, hoursPerPoint }`. The bridge:
 *   - unit 'days'   → a size is days, converted through the owner's calendar
 *                     `hoursPerDay` by `resolveEstimateMinutes` (hoursPerPoint unused)
 *   - unit 'points' → a size is story points at `settings.sizing.hoursPerPoint`
 *                     when a board sets one, else DEFAULT_HOURS_PER_POINT (8h = one
 *                     working day per point)
 */
import { resolveEstimateMinutes } from './estimate'
import type {
  BoardSizing,
  ConstraintType,
  ScheduleDependency,
  ScheduleMode,
  ScheduleTask,
  SolveWindow,
  TaskStatus,
} from './types'

export const DEFAULT_HOURS_PER_POINT = 8
export const DEFAULT_HOURS_PER_DAY = 8
/** Tasks without a column sort after every column. */
const NO_COLUMN_ORDER = Number.MAX_SAFE_INTEGER
const DAY_MS = 86_400_000
/** Minimum forward reach of the solve window; the index grows past it on demand. */
const WINDOW_AHEAD_DAYS = 60

/** The columns of a `board_tasks` row the schedule reads. Structural, so no db import. */
export interface ScheduleTaskRow {
  id: string
  status: string
  priority: string
  columnId: string | null
  startDate: Date | null
  endDate: Date | null
  size: number | null
  progress: number | null
  orderIndex: number
  completedAt: Date | null
  estimateMinutes: number | null
  scheduleMode: string
  constraintType: string
  constraintDate: Date | null
  isMilestone: boolean
  ownerResourceId: string | null
  startedAt: Date | null
}

export interface AssignmentRow {
  taskId: string
  userId?: string | null
  virtualMemberId?: string | null
  assignedAt: Date
}

export interface DependencyRow {
  blockerTaskId: string
  blockedTaskId: string
}

export interface AdapterContext {
  sizing: BoardSizing
  /** columnId → column orderIndex. */
  columnOrder: ReadonlyMap<string, number>
  /** taskId → who is on the card, any order; the earliest assignment is the owner. */
  assignments: ReadonlyMap<string, readonly AssignmentRow[]>
  resourceIdByUserId: ReadonlyMap<string, string>
  resourceIdByVirtualMemberId: ReadonlyMap<string, string>
  /** resourceId → its calendar's hoursPerDay, for day-sized cards. */
  hoursPerDayByResourceId: ReadonlyMap<string, number>
  defaultHoursPerDay: number
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function isUsableDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Reads the board's sizing block off `projects.settings`; mirrors `parseSizing` for the unit. */
export function sizingFromSettings(settings: Record<string, unknown> | null | undefined): BoardSizing {
  const raw = settings?.sizing as Record<string, unknown> | undefined
  const unit = raw && typeof raw === 'object' && raw.unit === 'points' ? 'points' : 'days'
  return {
    unit,
    hoursPerPoint: positiveOrNull(raw?.hoursPerPoint) ?? DEFAULT_HOURS_PER_POINT,
  }
}

export function toTaskStatus(status: string): TaskStatus {
  if (status === 'done') return 'done'
  if (status === 'in-progress') return 'in-progress'
  return 'todo'
}

export function toScheduleMode(mode: string): ScheduleMode {
  return mode === 'manual' ? 'manual' : 'auto'
}

export function toConstraintType(type: string): ConstraintType {
  return type === 'snet' || type === 'fnlt' ? type : 'asap'
}

export function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.medium
}

/**
 * The lane a card consumes: an explicit `ownerResourceId` wins; otherwise the
 * earliest assignment (real or virtual) that maps onto a resource. A card whose
 * assignees have no resource yet is unowned and the solver warns (`no-owner`).
 */
export function resolveOwnerResourceId(row: Pick<ScheduleTaskRow, 'id' | 'ownerResourceId'>, ctx: AdapterContext): string | null {
  if (row.ownerResourceId) return row.ownerResourceId
  const assignments = [...(ctx.assignments.get(row.id) ?? [])].sort(
    (a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || compareIdentity(a, b),
  )
  for (const a of assignments) {
    const resourceId = a.userId
      ? ctx.resourceIdByUserId.get(a.userId)
      : a.virtualMemberId
        ? ctx.resourceIdByVirtualMemberId.get(a.virtualMemberId)
        : undefined
    if (resourceId) return resourceId
  }
  return null
}

function compareIdentity(a: AssignmentRow, b: AssignmentRow): number {
  const ka = a.userId ?? a.virtualMemberId ?? ''
  const kb = b.userId ?? b.virtualMemberId ?? ''
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

export function toScheduleTask(row: ScheduleTaskRow, ctx: AdapterContext): ScheduleTask {
  const ownerResourceId = resolveOwnerResourceId(row, ctx)
  const hoursPerDay =
    (ownerResourceId ? ctx.hoursPerDayByResourceId.get(ownerResourceId) : undefined) ??
    ctx.defaultHoursPerDay
  const estimateMinutes = resolveEstimateMinutes(
    { estimateMinutes: row.estimateMinutes, size: row.size },
    ctx.sizing,
    { hoursPerDay },
  )
  return {
    id: row.id,
    status: toTaskStatus(row.status),
    scheduleMode: toScheduleMode(row.scheduleMode),
    constraintType: toConstraintType(row.constraintType),
    constraintDate: isUsableDate(row.constraintDate) ? row.constraintDate : null,
    plannedStart: isUsableDate(row.startDate) ? row.startDate : null,
    plannedEnd: isUsableDate(row.endDate) ? row.endDate : null,
    estimateMinutes,
    size: row.size,
    progress: row.progress,
    ownerResourceId,
    startedAt: isUsableDate(row.startedAt) ? row.startedAt : null,
    completedAt: isUsableDate(row.completedAt) ? row.completedAt : null,
    isMilestone: row.isMilestone === true,
    columnOrder: (row.columnId ? ctx.columnOrder.get(row.columnId) : undefined) ?? NO_COLUMN_ORDER,
    orderIndex: row.orderIndex,
    priority: priorityRank(row.priority),
  }
}

export function toScheduleTasks(rows: readonly ScheduleTaskRow[], ctx: AdapterContext): ScheduleTask[] {
  return rows.map((row) => toScheduleTask(row, ctx))
}

/** `task_dependencies` carries no type or lag: every edge is finish-to-start, zero lag. */
export function toScheduleDependencies(rows: readonly DependencyRow[]): ScheduleDependency[] {
  return rows.map((row) => ({
    blockerTaskId: row.blockerTaskId,
    blockedTaskId: row.blockedTaskId,
    type: 'fs',
    lagMinutes: 0,
  }))
}

export function groupAssignments(rows: readonly AssignmentRow[]): Map<string, AssignmentRow[]> {
  const out = new Map<string, AssignmentRow[]>()
  for (const row of rows) {
    const list = out.get(row.taskId)
    if (list) list.push(row)
    else out.set(row.taskId, [row])
  }
  return out
}

/**
 * The span the calendar index must cover, derived from the data alone (CHR-54):
 * back to the earliest actual or typed date so pins in the past still resolve,
 * and forward past the latest one. The index grows on demand beyond it.
 */
export function solveWindowFor(tasks: readonly ScheduleTask[], now: Date): SolveWindow {
  let start = now.getTime()
  let end = now.getTime() + WINDOW_AHEAD_DAYS * DAY_MS
  for (const t of tasks) {
    for (const d of [t.startedAt, t.completedAt, t.plannedStart, t.plannedEnd, t.constraintDate]) {
      if (!isUsableDate(d)) continue
      const ms = d.getTime()
      if (ms < start) start = ms
      if (ms + WINDOW_AHEAD_DAYS * DAY_MS > end) end = ms + WINDOW_AHEAD_DAYS * DAY_MS
    }
  }
  return { start: new Date(start), end: new Date(end) }
}
